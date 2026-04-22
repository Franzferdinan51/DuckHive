package tui

import (
	"time"

	"github.com/charmbracelet/bubbles/viewport"
	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
)

// MessageType distinguishes user, assistant, system, tool.
type MessageType int

const (
	MsgTypeUser       MessageType = iota
	MsgTypeAssistant
	MsgTypeSystem
	MsgTypeToolUse
	MsgTypeToolResult
	MsgTypeProgress
)

// Message represents a single message in the conversation.
type Message struct {
	ID        string
	Type      MessageType
	Content   string
	Timestamp time.Time
	Model     string // e.g. "claude-opus-4.6"
	ToolName  string // for tool_use messages
	IsStreaming bool
	IsError   bool
}

// AppContext is the active keybinding context.
type AppContext int

const (
	CtxGlobal AppContext = iota
	CtxChat
	CtxAutocomplete
	CtxConfirmation
	CtxSettings
	CtxSelect
)

// Model is the main Bubble Tea model for DuckHive.
type Model struct {
	// Messages
	messages []Message
	viewport viewport.Model

	// Input
	input textinput.Model

	// UI state
	ctx           AppContext
	spinner       spinner.Model
	isLoading     bool
	isStreaming   bool
	isSuspended   bool
	width         int
	height        int

	// Session
	sessionId  string
	modelName  string
	totalCost  float64

	// Pending confirmations / dialogs
	pendingConfirmation bool
	confirmationMsg     string
	onConfirm           func(bool)
}

// NewModel creates a fresh DuckHive TUI model.
func NewModel(width, height int) *Model {
	sp := spinner.New(spinner.WithSpinner(spinner.Dot))
	sp.Style = Styles.Spinner

	ti := textinput.New()
	ti.Prompt = "> "
	ti.Placeholder = "Ask DuckHive..."
	ti.Focus()
	ti.TextStyle = Styles.InputField

	vp := viewport.New(width, height-StatusHeight-InputHeight)
	vp.Style = Styles.MessageArea

	return &Model{
		messages:   []Message{},
		viewport:   vp,
		input:      ti,
		ctx:        CtxChat,
		spinner:    sp,
		isLoading:  false,
		width:      width,
		height:     height,
		modelName:  "claude-opus-4.6",
		sessionId:  "",
	}
}

// AddMessage appends a message to the list.
func (m *Model) AddMessage(msg Message) {
	m.messages = append(m.messages, msg)
}

// AddStreamingMessage adds or updates a streaming message.
func (m *Model) AddStreamingMessage(id, content string, msgType MessageType) {
	for i := range m.messages {
		if m.messages[i].ID == id {
			m.messages[i].Content = content
			return
		}
	}
	m.AddMessage(Message{
		ID:          id,
		Type:        msgType,
		Content:     content,
		Timestamp:   time.Now(),
		IsStreaming: true,
	})
}

// FinalizeMessage marks a streaming message as complete.
func (m *Model) FinalizeMessage(id string) {
	for i := range m.messages {
		if m.messages[i].ID == id {
			m.messages[i].IsStreaming = false
			return
		}
	}
}

// Init is called once at startup.
func (m *Model) Init() tea.Cmd {
	return func() tea.Msg { return m.spinner.Tick() }
}
