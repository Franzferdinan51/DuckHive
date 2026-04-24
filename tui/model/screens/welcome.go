package screens

import (
	"fmt"
	"os"

	"github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/gitlawb/duckhive/tui/model"
	"github.com/gitlawb/duckhive/tui/tui"
)

// WelcomeModel is the first screen shown on launch.
type WelcomeModel struct {
	width    int
	height   int
	selected int
	choices  []string
	onSelect func()
}

func NewWelcomeModel() WelcomeModel {
	return WelcomeModel{
		selected: 0,
		choices:  []string{"Start chatting", "Resume session", "Settings", "Exit"},
	}
}

// Init implements tea.Model.
func (m WelcomeModel) Init() tea.Cmd {
	return nil
}

// Update handles input for the welcome screen.
func (m *WelcomeModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height

	case tea.KeyMsg:
		switch msg.String() {
		case "up", "k":
			if m.selected > 0 {
				m.selected--
			}
		case "down", "j":
			if len(m.choices) > 0 && m.selected < len(m.choices)-1 {
				m.selected++
			}
		case "enter":
			return m, m.execute()
		}
	}
	return m, nil
}

func (m *WelcomeModel) execute() tea.Cmd {
	switch m.selected {
	case 0: // Start chatting
		return func() tea.Msg {
			return model.MsgNavigate{Screen: model.ScreenREPL}
		}
	case 1: // Resume session
		return func() tea.Msg {
			return model.MsgNavigate{Screen: model.ScreenREPL}
		}
	case 2: // Settings
		return func() tea.Msg {
			return model.MsgNavigate{Screen: model.ScreenSettings}
		}
	case 3: // Exit
		return tea.Quit
	}
	return nil
}

// View renders the welcome screen.
func (m *WelcomeModel) View() string {
	if m.width == 0 {
		m.width = 100
	}

	logo := tui.Header.Render("DuckHive")
	tagline := tui.DimText.Render("Capability-first TUI for coding, shell, council, media, MCP, ACP, and multi-agent workflows.")

	var items []string
	for i, c := range m.choices {
		prefix := "  "
		style := tui.DimText
		if i == m.selected {
			prefix = tui.Accent.Render("▶ ")
			style = tui.ModeIndicator
		}
		items = append(items, style.Render(prefix+c))
	}
	menu := lipgloss.JoinVertical(0, items...)

	wd, _ := os.Getwd()
	sysInfo := tui.DimText.Render(fmt.Sprintf("working: %s", wd))
	features := lipgloss.JoinVertical(0,
		tui.CardTitle.Render("Imported Pillars"),
		tui.CardMuted.Render("Codex: local agent + repo instructions"),
		tui.CardMuted.Render("Gemini: checkpoints + context files"),
		tui.CardMuted.Render("Kimi: shell mode + ACP"),
		tui.CardMuted.Render("OpenClaw: voice + multi-agent surfaces"),
		tui.CardMuted.Render("duck-cli: council + orchestration"),
		tui.CardMuted.Render("MiniMax + Mercury: media + budgets + daemon posture"),
	)

	return lipgloss.JoinVertical(0,
		logo,
		"",
		tagline,
		"",
		tui.Card.Render(menu),
		"",
		tui.Card.Render(features),
		"",
		sysInfo,
	)
}
