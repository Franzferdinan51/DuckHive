package components

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/viewport"
	"github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/gitlawb/duckhive/tui/model"
	"github.com/gitlawb/duckhive/tui/tui"
)

// MessageListModel renders a scrollable list of messages.
type MessageListModel struct {
	viewport   viewport.Model
	messages   []model.Message
	width      int
	height     int
	selectedID string
}

// NewMessageList creates a new message list with the given dimensions.
func NewMessageList(width, height int) MessageListModel {
	vp := viewport.New(width, height)
	vp.Style = tui.MessageArea
	return MessageListModel{
		viewport: vp,
		messages:  []model.Message{},
		width:    width,
		height:   height,
	}
}

// SetMessages replaces the current message list.
func (m *MessageListModel) SetMessages(msgs []model.Message) {
	m.messages = msgs
	m.update()
}

// AppendMessage adds a single message and scrolls to bottom.
func (m *MessageListModel) AppendMessage(msg model.Message) {
	m.messages = append(m.messages, msg)
	m.update()
	m.viewport.GotoBottom()
}

// UpdateMessage replaces a message by ID, returns true if found.
func (m *MessageListModel) UpdateMessage(id string, fn func(*model.Message)) bool {
	for i := range m.messages {
		if m.messages[i].ID == id {
			fn(&m.messages[i])
			m.update()
			return true
		}
	}
	return false
}

// StreamUpdate appends or updates streaming content for a message.
func (m *MessageListModel) StreamUpdate(id string, delta string) {
	for i := range m.messages {
		if m.messages[i].ID == id {
			m.messages[i].Content += delta
			m.messages[i].IsStreaming = true
			m.update()
			m.viewport.GotoBottom()
			return
		}
	}
	// New streaming message
	m.AppendMessage(model.Message{
		ID:          id,
		Type:        model.MsgTypeAssistant,
		Content:     delta,
		IsStreaming: true,
	})
}

// Finalize marks a streaming message as complete.
func (m *MessageListModel) Finalize(id string) {
	for i := range m.messages {
		if m.messages[i].ID == id {
			m.messages[i].IsStreaming = false
			m.update()
			return
		}
	}
}

// SetSelected highlights the given message ID.
func (m *MessageListModel) SetSelected(id string) {
	m.selectedID = id
}

// update regenerates the viewport content from messages.
func (m *MessageListModel) update() {
	var sb strings.Builder
	for _, msg := range m.messages {
		sb.WriteString(formatMessage(msg, m.width, m.selectedID == msg.ID))
		sb.WriteString("\n")
	}
	m.viewport.SetContent(sb.String())
}

// Update handles viewport scrolling and window resize.
func (m *MessageListModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.viewport.Width = msg.Width
		m.viewport.Height = msg.Height
		m.update()

	case viewport.ScrollMsg:
		m.viewport, _ = m.viewport.Update(msg)
	}
	return m, nil
}

// View returns the rendered viewport.
func (m *MessageListModel) View() string {
	return m.viewport.View()
}

// formatMessage renders a single message as a string.
func formatMessage(msg model.Message, width int, selected bool) string {
	var prefix string
	var style lipgloss.Style
	var label string

	switch msg.Type {
	case model.MsgTypeUser:
		prefix = ">"
		style = tui.UserBubble
		label = tui.DimText.Render("you")
	case model.MsgTypeAssistant:
		prefix = "<"
		style = tui.AssistantBubble
		label = tui.HeaderSubtitle.Render("duck")
	case model.MsgTypeSystem:
		prefix = "!"
		style = tui.SystemBubble
		label = ""
	case model.MsgTypeToolUse, model.MsgTypeToolResult:
		prefix = "#"
		style = tui.ToolBubble
		label = tui.ModeIndicator.Render(msg.ToolCalls[0].Name)
	case model.MsgTypeProgress:
		prefix = "..."
		style = tui.ProgressLine
		label = ""
	default:
		prefix = "|"
		style = tui.DimText
		label = ""
	}

	content := msg.Content
	if msg.IsStreaming {
		content += "▌"
	}
	if msg.IsError {
		style = tui.ErrorText
	}

	// Truncate long lines to fit width
	maxContentWidth := width - 10
	if len(content) > maxContentWidth {
		content = content[:maxContentWidth] + "..."
	}

	lines := strings.Split(content, "\n")
	var sb strings.Builder
	if label != "" {
		sb.WriteString(label)
		sb.WriteString("  ")
	}
	sb.WriteString(prefix)
	sb.WriteString(" ")
	sb.WriteString(content)

	if selected {
		sb.WriteString(" ")
		sb.WriteString(tui.Accent.Render("◀"))
	}

	return style.Render(sb.String())
}
