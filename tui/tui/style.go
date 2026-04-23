package tui

import (
	"github.com/charmbracelet/lipgloss"
)

// Style definitions for all DuckHive TUI components.
// Uses a flatter terminal-first look closer to a coding shell than a chat app.

var (
	// Base
	ColorBG       = lipgloss.Color("#111315")
	ColorSurface  = lipgloss.Color("#171A1D")
	ColorSurface2 = lipgloss.Color("#1E2227")
	ColorBorder   = lipgloss.Color("#2E343B")
	ColorText     = lipgloss.Color("#E6E8EA")
	ColorDim      = lipgloss.Color("#5E6873")
	ColorMuted    = lipgloss.Color("#98A2AD")

	// Brand
	ColorAccent = lipgloss.Color("#F3B33D")
	ColorDuck   = lipgloss.Color("#57B8FF")

	// Semantic
	ColorError    = lipgloss.Color("#F87171")
	ColorSuccess  = lipgloss.Color("#6FD3A3")
	ColorThinking = lipgloss.Color("#C8A7FF")
	ColorWarning  = lipgloss.Color("#F3B33D")

	// Header / footer
	ColorHeaderBG = lipgloss.Color("#14181C")

	// Message bubbles
	ColorUserBubble  = lipgloss.Color("#1A2733")
	ColorAssistantBG = lipgloss.Color("#171A1D")
	ColorSystemBG    = lipgloss.Color("#14181C")
	ColorToolBG      = lipgloss.Color("#1B2025")
)

// Header renders the top bar with logo, session info, and model name.
var Header = lipgloss.NewStyle().
	Background(ColorHeaderBG).
	Foreground(ColorText).
	Padding(0, 1)

var HeaderTitle = lipgloss.NewStyle().
	Foreground(ColorAccent).
	Bold(true)

var HeaderSubtitle = lipgloss.NewStyle().
	Foreground(ColorMuted)

// MessageArea is the scrollable viewport background.
var MessageArea = lipgloss.NewStyle().
	Foreground(ColorText).
	Padding(0, 1)

// UserBubble renders user messages.
var UserBubble = lipgloss.NewStyle().
	Foreground(lipgloss.Color("#F3F4F6")).
	Bold(true)

// AssistantBubble renders assistant messages.
var AssistantBubble = lipgloss.NewStyle().
	Foreground(ColorText)

// SystemBubble renders system messages centered/italic.
var SystemBubble = lipgloss.NewStyle().
	Foreground(ColorMuted).
	Italic(true)

// ToolBubble renders tool call messages.
var ToolBubble = lipgloss.NewStyle().
	Foreground(lipgloss.Color("#B8C0C8"))

// ProgressLine renders inline progress text.
var ProgressLine = lipgloss.NewStyle().
	Foreground(ColorDim).
	Italic(true)

// InputArea is the background behind the text input.
var InputArea = lipgloss.NewStyle().
	Foreground(ColorText).
	Padding(0, 0)

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
	Padding(0, 1)

var Card = lipgloss.NewStyle().
	Background(ColorSurface).
	Border(lipgloss.RoundedBorder()).
	BorderForeground(ColorBorder).
	Padding(0, 1)

var CardTitle = lipgloss.NewStyle().
	Foreground(ColorAccent).
	Bold(true)

var CardMuted = lipgloss.NewStyle().
	Foreground(ColorMuted)

var GoodBadge = lipgloss.NewStyle().
	Foreground(ColorBG).
	Background(ColorSuccess).
	Padding(0, 1).
	Bold(true)

var WarnBadge = lipgloss.NewStyle().
	Foreground(ColorBG).
	Background(ColorWarning).
	Padding(0, 1).
	Bold(true)

var SoftBadge = lipgloss.NewStyle().
	Foreground(ColorAccent).
	Background(ColorHeaderBG).
	Padding(0, 1)

var MainPane = lipgloss.NewStyle().
	Background(ColorBG).
	Border(lipgloss.NormalBorder(), false, false, true, false).
	BorderForeground(ColorBorder).
	Padding(0, 1, 1, 1)

var ComposerFrame = lipgloss.NewStyle().
	Background(ColorSurface).
	Border(lipgloss.RoundedBorder()).
	BorderForeground(ColorBorder).
	Padding(0, 1)

var ModePill = lipgloss.NewStyle().
	Foreground(ColorBG).
	Background(ColorAccent).
	Padding(0, 1).
	Bold(true)

var MetaPill = lipgloss.NewStyle().
	Foreground(ColorMuted).
	Background(ColorHeaderBG).
	Padding(0, 1)

var PillActive = lipgloss.NewStyle().
	Foreground(ColorBG).
	Background(ColorDuck).
	Padding(0, 1).
	Bold(true)

var PillOk = lipgloss.NewStyle().
	Foreground(ColorBG).
	Background(ColorSuccess).
	Padding(0, 1).
	Bold(true)

var PillWarn = lipgloss.NewStyle().
	Foreground(ColorBG).
	Background(ColorWarning).
	Padding(0, 1).
	Bold(true)

var PillMuted = lipgloss.NewStyle().
	Foreground(ColorMuted).
	Background(ColorSurface).
	Border(lipgloss.NormalBorder()).
	BorderForeground(ColorBorder).
	Padding(0, 1)

var EmptyCard = lipgloss.NewStyle().
	Background(ColorSurface).
	Border(lipgloss.RoundedBorder()).
	BorderForeground(ColorBorder).
	Padding(1, 2)

var SideCard = lipgloss.NewStyle().
	Background(ColorSurface).
	Border(lipgloss.NormalBorder()).
	BorderForeground(ColorBorder).
	Padding(1, 1)

var EmptyTitle = lipgloss.NewStyle().
	Foreground(ColorText).
	Bold(true)

var EmptyBody = lipgloss.NewStyle().
	Foreground(ColorMuted)

var SectionTitle = lipgloss.NewStyle().
	Foreground(ColorAccent).
	Bold(true)

var EmptyItem = lipgloss.NewStyle().
	Foreground(ColorText)

var MessageLabelUser = lipgloss.NewStyle().
	Foreground(ColorAccent).
	Bold(true)

var MessageLabelAssistant = lipgloss.NewStyle().
	Foreground(ColorDuck).
	Bold(true)

var MessageLabelSystem = lipgloss.NewStyle().
	Foreground(ColorMuted)

var MessageBody = lipgloss.NewStyle().
	Foreground(ColorText).
	PaddingLeft(2)

var ToolHeaderPending = lipgloss.NewStyle().
	Foreground(ColorWarning).
	Bold(true)

var ToolHeaderSuccess = lipgloss.NewStyle().
	Foreground(ColorSuccess).
	Bold(true)

var ToolHeaderError = lipgloss.NewStyle().
	Foreground(ColorError).
	Bold(true)

var ToolBody = lipgloss.NewStyle().
	Foreground(ColorMuted).
	Border(lipgloss.NormalBorder(), false, false, false, true).
	BorderForeground(ColorBorder).
	PaddingLeft(1)

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

// Accent is a reusable accent color style.
var Accent = lipgloss.NewStyle().
	Foreground(ColorAccent)

const MaxWidth = 80
