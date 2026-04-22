package tui

import (
	"fmt"
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
)

// Update handles all incoming messages and key events.
func (m *Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {

	switch msg := msg.(type) {

	// --- Window resize ---
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.viewport.Width = msg.Width
		m.viewport.Height = msg.Height - StatusHeight - InputHeight
		return m, nil

	// --- Spinner tick ---
	case spinner.TickMsg:
		s, cmd := m.spinner.Update(msg)
		m.spinner = s
		return m, cmd

	// --- Keyboard input ---
	case tea.KeyMsg:
		return m.handleKey(msg)

	// --- Viewport ---
	case vpDeltaMsg:
		m.viewport.YOffset += int(msg)
		return m, nil

	// --- Bridge ---
	case BridgeConnectedMsg:
		m.isLoading = true
		return m, nil

	case BridgeErrMsg:
		m.AddMessage(Message{
			ID:      newID(),
			Type:    MsgTypeSystem,
			Content: "Bridge error: " + msg.Err.Error(),
			IsError: true,
		})
		return m, nil

	case BackendEventMsg:
		if msg.Type == MsgTypeProgress || msg.Type == MsgTypeSystem {
			m.AddMessage(Message{
				ID:      msg.ID,
				Type:    msg.Type,
				Content: msg.Content,
			})
		} else {
			if msg.IsStreaming {
				m.AddStreamingMessage(msg.ID, msg.Content, msg.Type)
			} else {
				m.AddMessage(Message{
					ID:        msg.ID,
					Type:      msg.Type,
					Content:   msg.Content,
					IsError:   msg.IsError,
					Timestamp: now(),
				})
			}
		}
		return m, nil

	default:
		return m, nil
	}
}

// handleKey dispatches keys based on active context.
func (m *Model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch m.ctx {

	case CtxChat:
		cmds = m.handleChatKeys(msg)

	case CtxGlobal:
		cmds = m.handleGlobalKeys(msg)

	case CtxConfirmation:
		cmds = m.handleConfirmKeys(msg)

	default:
		cmds = m.handleChatKeys(msg)
	}

	return m, tea.Batch(cmds...)
}

// handleGlobalKeys handles always-active keybindings.
func (m *Model) handleGlobalKeys(msg tea.KeyMsg) (cmds []tea.Cmd) {
	switch msg.String() {
	case "ctrl+c":
		// Cancel current query
		return []tea.Cmd{func() tea.Msg {
			return SuspendMsg{}
		}}

	case "ctrl+d":
		// Exit
		return []tea.Cmd{tea.Quit}

	case "ctrl+l":
		// Redraw screen
		return []tea.Cmd{func() tea.Msg {
			return RedrawMsg{}
		}}

	case "ctrl+r":
		// History search (future)
		return nil

	case "ctrl+o":
		// Toggle transcript (future)
		return nil

	case "ctrl+t":
		// Toggle todos (future)
		return nil

	case "escape":
		m.ctx = CtxChat
	}
	return nil
}

// handleChatKeys handles chat input keys.
func (m *Model) handleChatKeys(msg tea.KeyMsg) (cmds []tea.Cmd) {
	switch msg.String() {

	case "enter":
		if m.pendingConfirmation {
			m.pendingConfirmation = false
			if m.onConfirm != nil {
				m.onConfirm(true)
			}
			return nil
		}
		text := m.input.Value()
		if text == "" {
			return nil
		}
		m.input.SetValue("")
		m.AddMessage(Message{
			ID:        newID(),
			Type:      MsgTypeUser,
			Content:   text,
			Timestamp: now(),
		})
		return []tea.Cmd{func() tea.Msg {
			return UserInputMsg{Text: text}
		}}

	case "ctrl+c":
		if m.isLoading || m.isStreaming {
			return []tea.Cmd{func() tea.Msg {
				return InterruptMsg{}
			}}
		}
		return []tea.Cmd{tea.Quit}

	case "ctrl+z":
		return []tea.Cmd{func() tea.Msg {
			return SuspendMsg{}
		}}

	case "up":
		if len(m.messages) > 0 {
			m.viewport.ScrollUp(1)
		}

	case "down":
		if len(m.messages) > 0 {
			m.viewport.ScrollDown(1)
		}

	case "pageup":
		m.viewport.ScrollUp(m.viewport.Height)

	case "pagedown":
		m.viewport.ScrollDown(m.viewport.Height)

	case "escape":
		// Cancel current input
		m.input.SetValue("")
		return []tea.Cmd{func() tea.Msg {
			return CancelMsg{}
		}}

	case "tab":
		// Autocomplete - pass through to input
		m.input, _ = m.input.Update(msg)
	}

	return nil
}

// handleConfirmKeys handles yes/no confirmations.
func (m *Model) handleConfirmKeys(msg tea.KeyMsg) (cmds []tea.Cmd) {
	switch msg.String() {
	case "y", "enter":
		m.pendingConfirmation = false
		if m.onConfirm != nil {
			m.onConfirm(true)
		}
	case "n", "escape":
		m.pendingConfirmation = false
		if m.onConfirm != nil {
			m.onConfirm(false)
		}
	}
	return nil
}

// --- Custom message types ---

// UserInputMsg carries a submitted user message to the backend.
type UserInputMsg struct{ Text string }

// InterruptMsg signals an in-progress request should be cancelled.
type InterruptMsg struct{}

// SuspendMsg suspends the TUI (Ctrl+Z).
type SuspendMsg struct{}

// RedrawMsg forces a full redraw.
type RedrawMsg struct{}

// CancelMsg cancels current input.
type CancelMsg struct{}

// BackendEventMsg wraps a message from the bridge.
type BackendEventMsg struct {
	Type      MessageType
	ID        string
	Content   string
	IsStreaming bool
	IsError   bool
}

// vpDeltaMsg carries viewport scroll delta from mouse events.
type vpDeltaMsg int

// newID generates a simple unique ID.
func newID() string {
	return fmt.Sprintf("msg-%d", now().UnixNano())
}

// now returns the current time.
func now() time.Time {
	return time.Now()
}
