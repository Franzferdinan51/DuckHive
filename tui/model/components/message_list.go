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
		messages: []model.Message{},
		width:    width,
		height:   height,
	}
}

// SetMessages replaces the current message list.
func (m *MessageListModel) SetMessages(msgs []model.Message) {
	m.messages = msgs
	m.update()
}

// SetSize updates the viewport dimensions.
func (m *MessageListModel) SetSize(width, height int) {
	if width > 0 {
		m.width = width
		m.viewport.Width = width
	}
	if height > 0 {
		m.height = height
		m.viewport.Height = height
	}
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

// ScrollUp scrolls the viewport up.
func (m *MessageListModel) ScrollUp(n int) {
	m.viewport.ScrollUp(n)
}

// ScrollDown scrolls the viewport down.
func (m *MessageListModel) ScrollDown(n int) {
	m.viewport.ScrollDown(n)
}

// GotoBottom scrolls to the last message.
func (m *MessageListModel) GotoBottom() {
	m.viewport.GotoBottom()
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

// Init implements tea.Model.
func (m MessageListModel) Init() tea.Cmd {
	return nil
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
	}
	return m, nil
}

// View returns the rendered viewport.
func (m *MessageListModel) View() string {
	return m.viewport.View()
}

// formatMessage renders a single message as a string.
func formatMessage(msg model.Message, width int, selected bool) string {
	maxContentWidth := width - 8
	if maxContentWidth < 24 {
		maxContentWidth = 24
	}

	switch msg.Type {
	case model.MsgTypeUser:
		return formatLabeledMessage(tui.MessageLabelUser.Render("YOU"), msg.Content, tui.UserBubble, maxContentWidth, msg.IsStreaming, selected)
	case model.MsgTypeAssistant:
		return formatLabeledMessage(tui.MessageLabelAssistant.Render("DUCKHIVE"), msg.Content, tui.AssistantBubble, maxContentWidth, msg.IsStreaming, selected)
	case model.MsgTypeSystem:
		return formatLabeledMessage(tui.MessageLabelSystem.Render("SYSTEM"), msg.Content, tui.SystemBubble, maxContentWidth, msg.IsStreaming, selected)
	case model.MsgTypeToolUse, model.MsgTypeToolResult:
		return formatToolMessage(msg, maxContentWidth, selected)
	case model.MsgTypeProgress:
		return tui.ProgressLine.MaxWidth(maxContentWidth).Render(msg.Content)
	}

	return tui.DimText.MaxWidth(maxContentWidth).Render(msg.Content)
}

func formatLabeledMessage(label, content string, style lipgloss.Style, width int, streaming, selected bool) string {
	if streaming {
		content += "▌"
	}
	body := style.MaxWidth(width).Render(content)
	body = tui.MessageBody.Width(width).Render(body)
	if selected {
		label = fmt.Sprintf("%s %s", label, tui.Accent.Render("[selected]"))
	}
	return lipgloss.JoinVertical(lipgloss.Left, label, body)
}

func formatToolMessage(msg model.Message, width int, selected bool) string {
	toolName := "tool"
	status := model.ToolStatusPending
	if len(msg.ToolCalls) > 0 {
		toolName = msg.ToolCalls[0].Name
		status = msg.ToolCalls[0].Status
	}

	headerStyle := tui.ToolHeaderPending
	headerIcon := ">"
	headerState := "running"
	switch status {
	case model.ToolStatusCompleted:
		headerStyle = tui.ToolHeaderSuccess
		headerIcon = "+"
		headerState = "done"
	case model.ToolStatusFailed:
		headerStyle = tui.ToolHeaderError
		headerIcon = "!"
		headerState = "failed"
	}

	header := headerStyle.Render(fmt.Sprintf("%s %s %s", headerIcon, strings.ToUpper(toolName), headerState))
	if selected {
		header = header + " " + tui.Accent.Render("[selected]")
	}

	content := msg.Content
	if msg.IsStreaming {
		content += "▌"
	}
	bodyStyle := tui.ToolBody
	if msg.IsError {
		bodyStyle = tui.ErrorText.Border(lipgloss.NormalBorder(), false, false, false, true).BorderForeground(tui.ColorBorder).PaddingLeft(1)
	}
	body := bodyStyle.MaxWidth(width).Render(content)
	return lipgloss.JoinVertical(lipgloss.Left, header, body)
}
