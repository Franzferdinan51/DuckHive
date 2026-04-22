package main

import (
	"os"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/gitlawb/duckhive/tui"
)

func main() {
	p := tea.NewProgram(
		tui.NewModel(80, 40),
		tea.WithAltScreen(),
		tea.WithMouseCellMotion(),
	)
	if _, err := p.Run(); err != nil {
		os.Exit(1)
	}
}
