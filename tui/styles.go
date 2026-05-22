package tui

import (
	"github.com/charmbracelet/lipgloss"
)

var Styles = struct {
	Header           lipgloss.Style
	HeaderTitle      lipgloss.Style
	HeaderSubtitle   lipgloss.Style
	MessageArea      lipgloss.Style
	UserBubble       lipgloss.Style
	AssistantBubble  lipgloss.Style
	SystemBubble     lipgloss.Style
	ToolBubble       lipgloss.Style
	InputArea        lipgloss.Style
	InputField       lipgloss.Style
	StatusBar        lipgloss.Style
	Spinner          lipgloss.Style
	ErrorText        lipgloss.Style
	DimText          lipgloss.Style
	Border           lipgloss.Style
	MutedBorder      lipgloss.Style
	Footer           lipgloss.Style
	HelpText         lipgloss.Style
	ModeIndicator    lipgloss.Style
	AccentTimer      lipgloss.Style // Timer display style
	ToolLifecycle    lipgloss.Style // Tool lifecycle state indicator (pi-inspired)
}{
	Header: lipgloss.NewStyle().
		Foreground(lipgloss.Color("#FAFAFA")).
		Padding(0, 1),

	HeaderTitle: lipgloss.NewStyle().
		Foreground(lipgloss.Color("#FFCB6B")).
		Bold(true),

	HeaderSubtitle: lipgloss.NewStyle().
		Foreground(lipgloss.Color("#8792A6")),

	MessageArea: lipgloss.NewStyle().
		Foreground(lipgloss.Color("#E0E0E0")).
		Padding(1, 2),

	UserBubble: lipgloss.NewStyle().
		Foreground(lipgloss.Color("#FAFAFA")).
		Padding(0, 1).
		MarginLeft(4),

	AssistantBubble: lipgloss.NewStyle().
		Foreground(lipgloss.Color("#E0E0E0")).
		Padding(0, 1).
		MarginRight(4),

	SystemBubble: lipgloss.NewStyle().
		Foreground(lipgloss.Color("#8792A6")).
		Padding(0, 1).
		Italic(true),

	ToolBubble: lipgloss.NewStyle().
		Foreground(lipgloss.Color("#A6ACCD")).
		Padding(0, 1),

	InputArea: lipgloss.NewStyle().
		Foreground(lipgloss.Color("#FAFAFA")).
		Padding(1, 2),

	InputField: lipgloss.NewStyle().
		Foreground(lipgloss.Color("#FAFAFA")).
		Border(lipgloss.NormalBorder()).
		BorderForeground(lipgloss.Color("#3D3D5C")).
		Padding(0, 1),

	StatusBar: lipgloss.NewStyle().
		Foreground(lipgloss.Color("#8792A6")).
		Padding(0, 2),

	Spinner: lipgloss.NewStyle().
		Foreground(lipgloss.Color("#FFCB6B")),

	ErrorText: lipgloss.NewStyle().
		Foreground(lipgloss.Color("#FF5370")),

	DimText: lipgloss.NewStyle().
		Foreground(lipgloss.Color("#4A4A6A")),

	Border: lipgloss.NewStyle().
		Border(lipgloss.NormalBorder()).
		BorderForeground(lipgloss.Color("#3D3D5C")),

	MutedBorder: lipgloss.NewStyle(),

	Footer: lipgloss.NewStyle().
		Foreground(lipgloss.Color("#4A4A6A")).
		Padding(0, 2),

	HelpText: lipgloss.NewStyle().
		Foreground(lipgloss.Color("#4A4A6A")),

	ModeIndicator: lipgloss.NewStyle().
		Foreground(lipgloss.Color("#FFCB6B")).
		Bold(true),

	AccentTimer: lipgloss.NewStyle().
		Foreground(lipgloss.Color("#6FD3A3")), // Green timer

	ToolLifecycle: lipgloss.NewStyle().
		Foreground(lipgloss.Color("#A6ACCD")).
		Italic(true), // Tool lifecycle state indicator
}

const (
	MaxWidth     = 80
	InputHeight  = 3
	StatusHeight = 1
)
