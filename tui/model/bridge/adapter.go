package bridge

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/charmbracelet/bubbletea"
	"github.com/gitlawb/duckhive/tui/model"
)

// Adapter connects the Bubble Tea TUI to the TypeScript backend.
// It can either connect via Unix socket or spawn the TS bridge as a subprocess.
type Adapter struct {
	mu         sync.RWMutex
	socketPath string
	conn       net.Conn
	inbound    chan model.InMsg
	outbound   chan json.RawMessage
	ctx        context.Context
	cancel     context.CancelFunc
	closed     bool

	// For subprocess mode
	bridgeCmd  string
	bridgeArgs []string
	stdin      io.WriteCloser
	proc       *os.Process
}

// NewAdapter creates a bridge adapter for the given socket path.
func NewAdapter(socketPath string) *Adapter {
	return &Adapter{
		socketPath: socketPath,
		inbound:    make(chan model.InMsg, 100),
		outbound:   make(chan json.RawMessage, 100),
	}
}

// NewSubprocessAdapter creates a bridge that spawns a given command.
// Pass the path to the TS bridge entry point.
func NewSubprocessAdapter(bridgeCmd string, args ...string) *Adapter {
	return &Adapter{
		bridgeCmd:  bridgeCmd,
		bridgeArgs: args,
		inbound:    make(chan model.InMsg, 100),
		outbound:   make(chan json.RawMessage, 100),
	}
}

// Start initiates the bridge connection. Returns a Bubble Tea command.
func (a *Adapter) Start() tea.Cmd {
	return func() tea.Msg {
		if a.bridgeCmd != "" {
			if err := a.startSubprocess(); err != nil {
				return model.MsgBridgeDisconnected{Err: err}
			}
		} else {
			if err := a.connect(); err != nil {
				return model.MsgBridgeDisconnected{Err: err}
			}
		}
		return model.MsgBridgeConnected{}
	}
}

// connect opens the Unix socket.
func (a *Adapter) connect() error {
	conn, err := net.DialTimeout("unix", a.socketPath, 5*time.Second)
	if err != nil {
		return fmt.Errorf("dial %s: %w", a.socketPath, err)
	}
	a.conn = conn
	go a.readLoop()
	go a.writeLoop()
	return nil
}

// startSubprocess spawns the TS bridge as a child process.
func (a *Adapter) startSubprocess() error {
	a.ctx, a.cancel = context.WithCancel(context.Background())

	cmd := exec.CommandContext(a.ctx, a.bridgeCmd, a.bridgeArgs...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start bridge: %w", err)
	}
	a.proc = cmd.Process
	a.stdin = stdin

	go a.readFrom(stdout)
	go a.readErrors(stderr)
	go a.writeLoop()

	go func() {
		cmd.Wait()
		a.mu.Lock()
		a.closed = true
		a.mu.Unlock()
		select {
		case a.inbound <- model.MsgBridgeDisconnected{Err: fmt.Errorf("bridge process exited")}:
		default:
		}
	}()

	return nil
}

// Send queues a JSON message to the backend.
func (a *Adapter) Send(payload json.RawMessage) error {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.closed {
		return fmt.Errorf("bridge closed")
	}
	select {
	case a.outbound <- payload:
		return nil
	default:
		return fmt.Errorf("outbound channel full")
	}
}

// Close terminates the bridge connection.
func (a *Adapter) Close() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.closed = true
	if a.cancel != nil {
		a.cancel()
	}
	if a.conn != nil {
		a.conn.Close()
	}
	if a.proc != nil {
		a.proc.Signal(syscall.SIGTERM)
	}
	if a.stdin != nil {
		a.stdin.Close()
	}
	return nil
}

// Subscription returns the channel for receiving inbound messages.
func (a *Adapter) Subscription() <-chan model.InMsg {
	return a.inbound
}

// readLoop pumps JSON messages from the socket to the inbound channel.
func (a *Adapter) readLoop() {
	dec := json.NewDecoder(a.conn)
	for {
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			if err == io.EOF {
				return
			}
			select {
			case a.inbound <- model.MsgError{Err: err}:
			default:
			}
			return
		}
		a.handleFrame(raw)
	}
}

// readFrom pumps JSON messages from a reader (subprocess stdout).
func (a *Adapter) readFrom(r io.Reader) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 2*1024*1024)
	for sc.Scan() {
		raw := sc.Bytes()
		a.handleFrame(raw)
	}
}

// readErrors pumps stderr lines as error messages.
func (a *Adapter) readErrors(r io.Reader) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 8*1024), 512*1024)
	for sc.Scan() {
		select {
		case a.inbound <- model.MsgError{Err: fmt.Errorf("bridge: %s", sc.Text())}:
		default:
		}
	}
}

// writeLoop pumps outbound messages from the channel to the socket.
func (a *Adapter) writeLoop() {
	for {
		a.mu.RLock()
		closed := a.closed
		conn := a.conn
		a.mu.RUnlock()
		if closed || conn == nil {
			return
		}

	select {
		case payload := <-a.outbound:
			data := append(payload, '\n')
			if a.bridgeCmd != "" && a.stdin != nil {
				if _, err := a.stdin.Write(data); err != nil {
					return
				}
				continue
			}
			if conn != nil {
				if _, err := conn.Write(data); err != nil {
					return
				}
			}
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
}

// handleFrame parses a raw JSON frame into a model.InMsg.
func (a *Adapter) handleFrame(raw []byte) {
	var f struct {
		Type string `json:"type"`
		ID   string `json:"id,omitempty"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		return
	}

	switch f.Type {
	case "message":
		var m model.Message
		if err := json.Unmarshal(raw, &m); err == nil {
			a.publish(model.MsgMessageReceived{Message: m})
		}
	case "stream_delta":
		var d struct {
			ID    string `json:"id"`
			Delta string `json:"delta"`
		}
		if err := json.Unmarshal(raw, &d); err == nil {
			a.publish(model.MsgStreamDelta{MessageID: d.ID, Delta: d.Delta})
		}
	case "stream_end":
		var d struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(raw, &d); err == nil {
			a.publish(model.MsgStreamEnd{MessageID: d.ID})
		}
	case "thinking_start":
		a.publish(model.MsgThinkingStarted{})
	case "thinking_end":
		a.publish(model.MsgThinkingEnded{})
	case "permission_request":
		var req model.PermissionRequest
		if err := json.Unmarshal(raw, &req); err == nil {
			a.publish(model.MsgPermissionRequest{Request: req})
		}
	case "error":
		var e struct {
			Err string `json:"error"`
		}
		if err := json.Unmarshal(raw, &e); err == nil {
			a.publish(model.MsgError{Err: fmt.Errorf("%s", e.Err)})
		}
	case "cost":
		var c struct {
			Cost float64 `json:"cost"`
		}
		if err := json.Unmarshal(raw, &c); err == nil {
			a.publish(model.MsgCostReceived{Cost: c.Cost})
		}
	case "tokens":
		var t model.TokenUsage
		if err := json.Unmarshal(raw, &t); err == nil {
			a.publish(model.MsgTokensReceived{Usage: t})
		}
	case "assistant":
		var m struct {
			UUID    string          `json:"uuid"`
			Message json.RawMessage `json:"message"`
		}
		if err := json.Unmarshal(raw, &m); err == nil {
			content := strings.TrimSpace(extractStructuredText(m.Message))
			if content != "" {
				a.publish(model.MsgMessageReceived{Message: model.Message{
					ID:        m.UUID,
					Type:      model.MsgTypeAssistant,
					Content:   content,
					Timestamp: time.Now(),
				}})
			}
		}
	case "streamlined_text":
		var m struct {
			UUID string `json:"uuid"`
			Text string `json:"text"`
		}
		if err := json.Unmarshal(raw, &m); err == nil && strings.TrimSpace(m.Text) != "" {
			a.publish(model.MsgMessageReceived{Message: model.Message{
				ID:        m.UUID,
				Type:      model.MsgTypeAssistant,
				Content:   m.Text,
				Timestamp: time.Now(),
			}})
		}
	case "system":
		var m struct {
			UUID    string `json:"uuid"`
			Subtype string `json:"subtype"`
			Content string `json:"content"`
			Status  string `json:"status"`
			Model   string `json:"model"`
		}
		if err := json.Unmarshal(raw, &m); err == nil {
			switch m.Subtype {
			case "init":
				if strings.TrimSpace(m.Model) != "" {
					a.publish(model.MsgModelChanged{Model: m.Model})
				}
				a.publish(model.MsgStatusUpdate{Message: "backend ready"})
			case "status":
				if strings.TrimSpace(m.Status) != "" {
					a.publish(model.MsgStatusUpdate{Message: m.Status})
				}
			case "local_command_output":
				if strings.TrimSpace(m.Content) != "" {
					a.publish(model.MsgMessageReceived{Message: model.Message{
						ID:        m.UUID,
						Type:      model.MsgTypeSystem,
						Content:   m.Content,
						Timestamp: time.Now(),
					}})
				}
			default:
				if strings.TrimSpace(m.Content) != "" {
					a.publish(model.MsgMessageReceived{Message: model.Message{
						ID:        m.UUID,
						Type:      model.MsgTypeSystem,
						Content:   m.Content,
						Timestamp: time.Now(),
					}})
				}
			}
		}
	case "result":
		var r struct {
			Subtype string   `json:"subtype"`
			IsError bool     `json:"is_error"`
			Result  string   `json:"result"`
			Errors  []string `json:"errors"`
		}
		if err := json.Unmarshal(raw, &r); err == nil {
			a.publish(model.MsgThinkingEnded{})
			if r.IsError {
				errText := strings.TrimSpace(strings.Join(r.Errors, "\n"))
				if errText == "" {
					errText = strings.TrimSpace(r.Result)
				}
				if errText != "" {
					a.publish(model.MsgError{Err: fmt.Errorf("%s", errText)})
				}
			}
		}
	case "control_request":
		var req struct {
			RequestID string `json:"request_id"`
			Request   struct {
				Subtype     string         `json:"subtype"`
				ToolName    string         `json:"tool_name"`
				Input       map[string]any `json:"input"`
				Description string         `json:"description"`
			} `json:"request"`
		}
		if err := json.Unmarshal(raw, &req); err == nil && req.Request.Subtype == "can_use_tool" {
			a.publish(model.MsgPermissionRequest{Request: model.PermissionRequest{
				ID:       req.RequestID,
				ToolName: req.Request.ToolName,
				Input:    req.Request.Input,
				Meta:     req.Request.Description,
			}})
		}
	case "control_response":
		return
	default:
		return
	}
}

func (a *Adapter) publish(msg model.InMsg) {
	if msg == nil {
		return
	}
	select {
	case a.inbound <- msg:
	default:
	}
}

func extractStructuredText(raw json.RawMessage) string {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return ""
	}
	return extractStructuredValue(value)
}

func extractStructuredValue(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case []any:
		parts := make([]string, 0, len(v))
		for _, item := range v {
			text := strings.TrimSpace(extractStructuredValue(item))
			if text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	case map[string]any:
		if content, ok := v["content"]; ok {
			return extractStructuredValue(content)
		}
		if text, ok := v["text"].(string); ok {
			return text
		}
		if thinking, ok := v["thinking"].(string); ok {
			return thinking
		}
		if result, ok := v["result"].(string); ok {
			return result
		}
		}
	}
	return ""
}

func SendPermissionResponseCmd(bridge *Adapter, req model.PermissionRequest, approved bool) tea.Cmd {
	return func() tea.Msg {
		if bridge == nil {
			return nil
		}

		var payload any
		if bridge.bridgeCmd != "" {
			response := map[string]any{
				"type": "control_response",
				"response": map[string]any{
					"subtype":    "success",
					"request_id": req.ID,
					"response": map[string]any{
						"toolUseID": req.ID,
					},
				},
			}
			if approved {
				response["response"].(map[string]any)["response"] = map[string]any{
					"behavior":    "allow",
					"updatedInput": req.Input,
					"toolUseID":   req.ID,
				}
			} else {
				response["response"].(map[string]any)["response"] = map[string]any{
					"behavior":  "deny",
					"message":   "Denied from DuckHive TUI",
					"toolUseID": req.ID,
				}
			}
			payload = response
		} else {
			payload = map[string]any{
				"type":     "permission_response",
				"approved": approved,
				"id":       req.ID,
			}
		}

		raw, _ := json.Marshal(payload)
		if err := bridge.Send(raw); err != nil {
			return model.MsgError{Err: err}
		}
		return nil
	}
}

// SendUserMessageCmd creates a command to send a user message.
func SendUserMessageCmd(bridge *Adapter, text string) tea.Cmd {
	return func() tea.Msg {
		var payload []byte
		if bridge.bridgeCmd != "" {
			payload, _ = json.Marshal(map[string]any{
				"type": "user",
				"message": map[string]any{
					"role":    "user",
					"content": text,
				},
				"parent_tool_use_id": nil,
				"timestamp":          time.Now().Format(time.RFC3339),
			})
		} else {
			payload, _ = json.Marshal(map[string]any{
				"type": "user_message",
				"text": text,
				"time": time.Now().Unix(),
			})
		}
		if err := bridge.Send(payload); err != nil {
			return model.MsgError{Err: err}
		}
		return nil
	}
}

// SendInterruptCmd creates a command to interrupt the backend.
func SendInterruptCmd(bridge *Adapter) tea.Cmd {
	return func() tea.Msg {
		var payload []byte
		if bridge.bridgeCmd != "" {
			payload, _ = json.Marshal(map[string]any{
				"type":       "control_request",
				"request_id": fmt.Sprintf("interrupt-%d", time.Now().UnixNano()),
				"request": map[string]any{
					"subtype": "interrupt",
				},
			})
		} else {
			payload, _ = json.Marshal(map[string]any{"type": "interrupt"})
		}
		if err := bridge.Send(payload); err != nil {
			return model.MsgError{Err: err}
		}
		return nil
	}
}

// BridgeSubscription creates a Bubble Tea subscription from a bridge adapter.
func BridgeSubscription(bridge *Adapter) func(msg tea.Msg) bool {
	return func(msg tea.Msg) bool {
		switch msg.(type) {
		case model.InMsg:
			return true
		default:
			return false
		}
	}
}
