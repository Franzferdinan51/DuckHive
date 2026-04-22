package tui

import (
	"github.com/charmbracelet/lipgloss"
)

// Style definitions for all DuckHive TUI components.
// Uses a dark theme matching the original Ink/React look.

var (
	// Base
	ColorBG        = lipgloss.Color("#16161E")
	ColorSurface   = lipgloss.Color("#1E1E2E")
	ColorSurface2  = lipgloss.Color("#252535")
	ColorBorder    = lipgloss.Color("#3D3D5C")
	ColorText      = lipgloss.Color("#E0E0E0")
	ColorDim       = lipgloss.Color("#4A4A6A")
	ColorMuted    = lipgloss.Color("#8792A6")

	// Brand
	ColorAccent    = lipgloss.Color("#FFCB6B") // gold
	ColorDuck      = lipgloss.Color("#4FC3F7") // blue

	// Semantic
	ColorError     = lipgloss.Color("#FF5370")
	ColorSuccess   = lipgloss.Color("#81C784")
	ColorThinking  = lipgloss.Color("#CE93D8")

	// Header / footer
	ColorHeaderBG  = lipgloss.Color("#1A1A2E")

	// Message bubbles
	ColorUserBubble   = lipgloss.Color("#2D5A8A")
	ColorAssistantBG  = lipgloss.Color("#1E1E2E")
	ColorSystemBG     = lipgloss.Color("#1A1A2E")
	ColorToolBG       = lipgloss.Color("#252535")
)

// Header renders the top bar with logo, session info, and model name.
var Header = lipgloss.NewStyle().
	Background(ColorHeaderBG).
	Foreground(ColorText).
	Padding(0, 1).
	Width(MaxWidth)

var HeaderTitle = lipgloss.NewStyle().
	Foreground(ColorAccent).
	Bold(true)

var HeaderSubtitle = lipgloss.NewStyle().
	Foreground(ColorMuted)

// MessageArea is the scrollable viewport background.
var MessageArea = lipgloss.NewStyle().
	Foreground(ColorText).
	Padding(1, 2)

// UserBubble renders user messages right-aligned.
var UserBubble = lipgloss.NewStyle().
	Foreground(lipgloss.Color("#FAFAFA")).
	Background(ColorUserBubble).
	Padding(0, 1).
	MarginLeft(4)

// AssistantBubble renders assistant messages left-aligned.
var AssistantBubble = lipgloss.NewStyle().
	Foreground(ColorText).
	Background(ColorAssistantBG).
	Padding(0, 1).
	MarginRight(4)

// SystemBubble renders system messages centered/italic.
var SystemBubble = lipgloss.NewStyle().
	Foreground(ColorMuted).
	Background(ColorSystemBG).
	Padding(0, 1).
	Italic(true)

// ToolBubble renders tool call messages.
var ToolBubble = lipgloss.NewStyle().
	Foreground(lipgloss.Color("#A6ACCD")).
	Background(ColorToolBG).
	Padding(0, 1)

// ProgressLine renders inline progress text.
var ProgressLine = lipgloss.NewStyle().
	Foreground(ColorDim).
	Italic(true)

// InputArea is the background behind the text input.
var InputArea = lipgloss.NewStyle().
	Background(ColorSurface).
	Foreground(ColorText).
	Padding(1, 2)

// InputField is the actual text input border/prompt area.
var InputField = lipgloss.NewStyle().
	Foreground(ColorAccent).
	Background(ColorSurface2).
	Border(lipgloss.NormalBorder()).
	BorderForeground(ColorBorder).
	Padding(0, 1)

// StatusBar is the bottom footer.
var StatusBar = lipgloss.NewStyle().
	Background(ColorHeaderBG).
	Foreground(ColorMuted).
	Padding(0, 2)

var SpinnerStyle = lipgloss.NewStyle().
	Foreground(ColorAccent)

var ErrorText = lipgloss.NewStyle().
	Foreground(ColorError)

var DimText = lipgloss.NewStyle().
	Foreground(ColorDim)

// Dialog is a centered overlay panel.
var Dialog = lipgloss.NewStyle().
	Background(ColorSurface).
	Border(lipgloss.RoundedBorder()).
	BorderForeground(ColorAccent).
	Padding(2, 4).
	MarginTop(4).
	Width(MaxWidth - 20).
	Align(lipgloss.Center)

var DialogTitle = lipgloss.NewStyle().
	Foreground(ColorAccent).
	Bold(true)

var DialogBody = lipgloss.NewStyle().
	Foreground(ColorText).
	MarginTop(1)

var HelpText = lipgloss.NewStyle().
	Foreground(ColorDim).
	Padding(0, 2)

var ModeIndicator = lipgloss.NewStyle().
	Foreground(ColorAccent).
	Bold(true)

const MaxWidth = 80
