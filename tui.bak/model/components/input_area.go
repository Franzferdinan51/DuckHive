package components

import (
	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/gitlawb/duckhive/tui/tui"
)

// InputAreaModel wraps a bubbles textarea for multi-line user input.
type InputAreaModel struct {
	ta       textarea.Model
	history  []string
	histIdx  int
	submitFn func(string)
	vimMode  bool
}

// NewInputArea creates a focused input area with the given dimensions.
func NewInputArea(width, height int) InputAreaModel {
	ta := textarea.New()
	ta.Placeholder = "Ask DuckHive..."
	ta.Prompt = tui.ModeIndicator.Render("› ")
	ta.CharLimit = 10000
	ta.SetWidth(width)
	ta.SetHeight(height)
	ta.Focus()

	ta.Cursor.Style = lipgloss.NewStyle().
		Foreground(tui.ColorAccent)

	return InputAreaModel{
		ta:      ta,
		history: []string{},
		histIdx: -1,
	}
}

// SetValue sets the input text programmatically.
func (m *InputAreaModel) SetValue(val string) {
	m.ta.SetValue(val)
}

// Value returns the current input text.
func (m *InputAreaModel) Value() string {
	return m.ta.Value()
}

// SetSubmitFn records the callback for when Enter is pressed.
func (m *InputAreaModel) SetSubmitFn(fn func(string)) {
	m.submitFn = fn
}

// SetHistory loads command history for up/down navigation.
func (m *InputAreaModel) SetHistory(hist []string) {
	m.history = hist
	m.histIdx = len(hist)
}

// ToggleVimMode switches between standard and vim input mode.
func (m *InputAreaModel) ToggleVimMode() {
	m.vimMode = !m.vimMode
	m.ta.SetVimMode(m.vimMode)
}

// Update handles textarea events and dispatches submit.
func (m *InputAreaModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "enter":
			if !msg.Alt {
				val := m.ta.Value()
				if val != "" {
					if m.submitFn != nil {
						m.submitFn(val)
					}
					// Add to history
					m.history = append(m.history, val)
					m.histIdx = len(m.history)
					m.ta.Reset()
				}
				return m, nil
			}

		case "up":
			if m.ta.Cursor() == 0 && len(m.history) > 0 {
				if m.histIdx > 0 {
					m.histIdx--
					m.ta.SetValue(m.history[m.histIdx])
					m.ta.CursorEnd()
				}
				return m, nil
			}

		case "down":
			if m.ta.Cursor() == len(m.ta.Value()) && len(m.history) > 0 {
				if m.histIdx < len(m.history)-1 {
					m.histIdx++
					m.ta.SetValue(m.history[m.histIdx])
				} else {
					m.histIdx = len(m.history)
					m.ta.Reset()
				}
				return m, nil
			}
		}
	}

	var cmd tea.Cmd
	m.ta, cmd = m.ta.Update(msg)
	return m, cmd
}

// View returns the rendered textarea.
func (m *InputAreaModel) View() string {
	return tui.InputArea.Render(m.ta.View())
}
