package tui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// View renders the full TUI.
func (m *Model) View() string {
	if m.isSuspended {
		return Styles.DimText.Render("\nDuckHive suspended. Run `fg` to bring it back.\n")
	}

	var sb strings.Builder

	sb.WriteString(m.headerView())
	sb.WriteString(m.messagesView())
	sb.WriteString(m.statusView())
	sb.WriteString(m.inputView())

	return sb.String()
}

// headerView renders the top bar with logo/title.
func (m *Model) headerView() string {
	title := Styles.HeaderTitle.Render("DuckHive")
	version := Styles.HeaderSubtitle.Render("v0.7.0")
	status := ""
	if m.isLoading {
		status = " " + m.spinner.View()
	}
	if m.modelName != "" {
		status += " " + Styles.DimText.Render(m.modelName)
	}
	if m.totalCost > 0 {
		status += " " + Styles.DimText.Render(fmt.Sprintf("$%.4f", m.totalCost))
	}

	left := fmt.Sprintf(" %s %s", title, version)
	right := status

	header := Styles.Header.
		Width(m.width).
		Render(padLeft(left, m.width-len(stripAnsi(right))) + right)

	return header + "\n"
}

// messagesView renders the scrollable message list.
func (m *Model) messagesView() string {
	var sb strings.Builder

	for _, msg := range m.messages {
		sb.WriteString(renderMessage(msg))
	}

	m.viewport.SetContent(sb.String())
	return m.viewport.View()
}

// statusView renders the bottom status bar.
func (m *Model) statusView() string {
	segments := []string{}

	if m.isLoading {
		segments = append(segments, m.spinner.View()+" processing")
	}
	if m.isStreaming {
		segments = append(segments, "streaming...")
	}

	left := strings.Join(segments, "  ")
	right := ""
	if m.ctx != CtxChat {
		right = Styles.ModeIndicator.Render(contextLabel(m.ctx))
	}

	width := m.width - len(stripAnsi(left)) - len(stripAnsi(right))
	if width < 0 {
		width = 0
	}

	return Styles.StatusBar.Width(m.width).Render(padLeft(left, width) + right) + "\n"
}

// inputView renders the text input area.
func (m *Model) inputView() string {
	inputBorder := Styles.InputField
	if m.ctx == CtxConfirmation {
		inputBorder = inputBorder.BorderForeground(lipgloss.Color("#FF5370"))
	}

	prompt := Styles.ModeIndicator.Render("› ")
	input := m.input.View()
	return Styles.InputArea.Width(m.width).Render(prompt + input) + "\n"
}

// renderMessage turns a Message into a rendered string.
func renderMessage(msg Message) string {
	var bubble string

	switch msg.Type {
	case MsgTypeUser:
		label := Styles.DimText.Render("you")
		bubble = Styles.UserBubble.Render(label + "  " + msg.Content)

	case MsgTypeAssistant:
		label := Styles.HeaderSubtitle.Render("duck")
		content := msg.Content
		if msg.IsStreaming {
			content += "▌"
		}
		bubble = Styles.AssistantBubble.Render(label + "\n" + content)

	case MsgTypeSystem:
		bubble = Styles.SystemBubble.Render(msg.Content)

	case MsgTypeToolUse:
		toolLabel := Styles.DimText.Render("tool:") + " " +
			Styles.ModeIndicator.Render(msg.ToolName)
		bubble = Styles.ToolBubble.Render(toolLabel + "  " + msg.Content)

	case MsgTypeProgress:
		bubble = Styles.DimText.Render(msg.Content)

	default:
		bubble = Styles.DimText.Render(msg.Content)
	}

	return bubble + "\n"
}

// contextLabel returns a human-readable label for an AppContext.
func contextLabel(ctx AppContext) string {
	switch ctx {
	case CtxChat:
		return "CHAT"
	case CtxConfirmation:
		return "CONFIRM"
	case CtxSettings:
		return "SETTINGS"
	case CtxSelect:
		return "SELECT"
	default:
		return "GLOBAL"
	}
}

// padLeft pads a string to the left to fill width.
func padLeft(s string, width int) string {
	visible := len(stripAnsi(s))
	if visible >= width {
		return s
	}
	pad := strings.Repeat(" ", width-visible)
	return pad + s
}

// stripAnsi removes ANSI escape codes for plain-text length calculation.
func stripAnsi(s string) string {
	// Simple strip - just estimate for padding purposes
	// Real implementation would strip \x1b[...m
	in := false
	var r strings.Builder
	for _, ch := range s {
		if ch == '\x1b' {
			in = true
			continue
		}
		if ch == 'm' && in {
			in = false
			continue
		}
		if !in {
			r.WriteRune(ch)
		}
	}
	return r.String()
}
