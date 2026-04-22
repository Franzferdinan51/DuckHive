package components

import (
	"github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/gitlawb/duckhive/tui/model"
	"github.com/gitlawb/duckhive/tui/tui"
)

// DialogModel is a generic centered overlay dialog.
type DialogModel struct {
	title    string
	body     string
	choices  []string
	selected int
	onSelect func(int)
	onCancel func()
	focused  bool
}

// NewDialog creates a new dialog with title, body, and choices.
func NewDialog(title, body string, choices []string, onSelect func(int), onCancel func()) DialogModel {
	return DialogModel{
		title:    title,
		body:     body,
		choices:  choices,
		selected: 0,
		onSelect: onSelect,
		onCancel: onCancel,
		focused:  true,
	}
}

// Update handles keyboard navigation within the dialog.
func (m *DialogModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "up", "k":
			if m.selected > 0 {
				m.selected--
			}
		case "down", "j":
			if m.selected < len(m.choices)-1 {
				m.selected++
			}
		case "enter":
			if m.onSelect != nil {
				m.onSelect(m.selected)
			}
		case "escape":
			if m.onCancel != nil {
				m.onCancel()
			}
		}
	}
	return m, nil
}

// View renders the dialog.
func (m *DialogModel) View() string {
	inner := tui.DialogTitle.Render(m.title) + "\n\n"
	inner += tui.DialogBody.Render(m.body) + "\n\n"

	for i, c := range m.choices {
		prefix := "  "
		style := tui.DimText
		if i == m.selected {
			prefix = tui.Accent.Render("▶ ")
			style = tui.ModeIndicator
		}
		inner += style.Render(prefix + c) + "\n"
	}

	return tui.Dialog.Render(inner)
}

// NewPermissionDialog creates a dialog for tool permission requests.
func NewPermissionDialog(req model.PermissionRequest) DialogModel {
	body := "Tool: " + req.ToolName
	if req.Meta != "" {
		body += "\n" + req.Meta
	}
	return NewDialog(
		"Permission Request",
		body,
		[]string{"Allow once", "Allow always", "Deny"},
		func(idx int) {},
		func() {},
	)
}
