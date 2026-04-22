package tui

import (
	"github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/bubbletea/key"
)

// KeyMap holds all keyboard shortcuts, organized by context.
type KeyMap struct {
	// Global — always active
	Interrupt         key.Binding
	Exit             key.Binding
	Redraw           key.Binding
	ToggleTranscript key.Binding
	ToggleTodos      key.Binding
	GlobalSearch     key.Binding

	// Chat — active while in Chat context
	Submit          key.Binding
	HistoryUp       key.Binding
	HistoryDown     key.Binding
	Cancel          key.Binding
	CycleMode       key.Binding
	ModelPicker     key.Binding
	FastMode        key.Binding
	ThinkingToggle  key.Binding
	ExternalEditor  key.Binding
	Undo            key.Binding
	ImagePaste      key.Binding
	Stash           key.Binding

	// Navigation within message list
	MsgPageUp    key.Binding
	MsgPageDown  key.Binding
	MsgTop       key.Binding
	MsgBottom    key.Binding
	MsgSelect    key.Binding

	// Confirmation dialog
	ConfirmYes  key.Binding
	ConfirmNo   key.Binding
}

// DefaultKeyMap returns the full keybinding set.
func DefaultKeyMap() KeyMap {
	return KeyMap{

		// Global
		Interrupt: key.NewBinding(
			key.WithKeys(key.CtrlC),
			key.WithHelp("ctrl+c", "interrupt"),
		),
		Exit: key.NewBinding(
			key.WithKeys(key.CtrlD),
			key.WithHelp("ctrl+d", "exit"),
		),
		Redraw: key.NewBinding(
			key.WithKeys(key.CtrlL),
			key.WithHelp("ctrl+l", "redraw"),
		),
		ToggleTranscript: key.NewBinding(
			key.WithKeys(key.CtrlO),
			key.WithHelp("ctrl+o", "transcript"),
		),
		ToggleTodos: key.NewBinding(
			key.WithKeys(key.CtrlT),
			key.WithHelp("ctrl+t", "todos"),
		),
		GlobalSearch: key.NewBinding(
			key.WithKeys(key.CtrlR),
			key.WithHelp("ctrl+r", "search"),
		),

		// Chat
		Submit: key.NewBinding(
			key.WithKeys(key.Enter),
			key.WithHelp("enter", "send"),
		),
		HistoryUp: key.NewBinding(
			key.WithKeys(key.Up),
			key.WithHelp("up", "history prev"),
		),
		HistoryDown: key.NewBinding(
			key.WithKeys(key.Down),
			key.WithHelp("down", "history next"),
		),
		Cancel: key.NewBinding(
			key.WithKeys(key.Escape),
			key.WithHelp("esc", "cancel"),
		),
		CycleMode: key.NewBinding(
			key.WithKeys(key.ShiftTab),
			key.WithHelp("shift+tab", "cycle mode"),
		),
		ModelPicker: key.NewBinding(
			key.WithKeys(key.CtrlP),
			key.WithHelp("ctrl+p", "model"),
		),
		FastMode: key.NewBinding(
			key.WithKeys(key.CtrlF),
			key.WithHelp("ctrl+f", "fast mode"),
		),
		ThinkingToggle: key.NewBinding(
			key.WithKeys(key.CtrlK),
			key.WithHelp("ctrl+k", "thinking"),
		),
		ExternalEditor: key.NewBinding(
			key.WithKeys(key.CtrlX, key.CtrlE),
			key.WithHelp("ctrl+x ctrl+e", "edit"),
		),
		Undo: key.NewBinding(
			key.WithKeys(key.CtrlUnderscore),
			key.WithHelp("ctrl+_", "undo"),
		),
		ImagePaste: key.NewBinding(
			key.WithKeys(key.CtrlV),
			key.WithHelp("ctrl+v", "paste image"),
		),
		Stash: key.NewBinding(
			key.WithKeys(key.CtrlZ),
			key.WithHelp("ctrl+z", "suspend"),
		),

		// Message navigation
		MsgPageUp: key.NewBinding(
			key.WithKeys(key.PageUp),
			key.WithHelp("pgup", "page up"),
		),
		MsgPageDown: key.NewBinding(
			key.WithKeys(key.PageDown),
			key.WithHelp("pgdn", "page down"),
		),
		MsgTop: key.NewBinding(
			key.WithKeys(key.Home),
			key.WithHelp("home", "top"),
		),
		MsgBottom: key.NewBinding(
			key.WithKeys(key.End),
			key.WithHelp("end", "bottom"),
		),
		MsgSelect: key.NewBinding(
			key.WithKeys(key.Tab),
			key.WithHelp("tab", "select"),
		),

		// Confirmation
		ConfirmYes: key.NewBinding(
			key.WithKeys("y", key.Enter),
			key.WithHelp("y/enter", "yes"),
		),
		ConfirmNo: key.NewBinding(
			key.WithKeys("n", key.Escape),
			key.WithHelp("n/esc", "no"),
		),
	}
}

// ActiveBindings returns the bindings relevant to the given context.
func ActiveBindings(km KeyMap, ctx string) []key.Binding {
	switch ctx {
	case "Chat":
		return []key.Binding{
			km.Submit, km.HistoryUp, km.HistoryDown, km.Cancel,
			km.CycleMode, km.FastMode, km.ThinkingToggle,
			km.ExternalEditor, km.Undo, km.Stash,
		}
	case "Confirmation":
		return []key.Binding{km.ConfirmYes, km.ConfirmNo}
	case "Settings":
		return []key.Binding{km.Cancel, km.Submit}
	default:
		return []key.Binding{
			km.Interrupt, km.Exit, km.Redraw,
			km.ToggleTranscript, km.ToggleTodos, km.GlobalSearch,
		}
	}
}

// HandleKey resolves a key press to a model.OutMsg based on active context.
// Returns nil if the key is not handled.
func HandleKey(msg tea.KeyMsg, km KeyMap, ctx string) (out model.OutMsg, consumed bool) {
	bindings := ActiveBindings(km, ctx)
	for _, b := range bindings {
		if b.Matches(msg) {
			return applyBinding(msg, b, ctx)
		}
	}
	return nil, false
}

func applyBinding(msg tea.KeyMsg, b key.Binding, ctx string) (model.OutMsg, bool) {
	switch b.String() {
	case "ctrl+c":
		return model.MsgInterrupt{}, true
	case "ctrl+d":
		return model.MsgExit{}, true
	case "ctrl+l":
		return model.MsgRedraw{}, true
	case "ctrl+o":
		return model.MsgToggleTranscript{}, true
	case "ctrl+t":
		return model.MsgToggleTodos{}, true
	case "ctrl+r":
		return model.MsgNavigate{Screen: model.ScreenREPL}, true // history search
	case "enter":
		if ctx == "Chat" {
			return model.MsgInputSubmitted{}, true
		}
		return model.MsgConfirmYes{}, true
	case "up":
		if ctx == "Chat" {
			return model.MsgHistoryUp{}, true
		}
		return model.MsgSelectMessage{ID: ""}, true
	case "down":
		if ctx == "Chat" {
			return model.MsgHistoryDown{}, true
		}
	case "escape":
		if ctx == "Chat" {
			return model.MsgCancelInput{}, true
		}
		return model.MsgPopDialog{}, true
	case "shift+tab":
		return model.MsgCycleMode{}, true
	case "ctrl+p":
		return model.MsgModelPicker{}, true
	case "ctrl+f":
		return model.MsgToggleFastMode{}, true
	case "ctrl+x ctrl+e":
		return model.MsgExternalEditor{}, true
	case "ctrl+z":
		return model.MsgSuspend{}, true
	case "y":
		return model.MsgConfirmYes{}, true
	case "n":
		return model.MsgConfirmNo{}, true
	case "pageup":
		return model.MsgPageUp{}, true
	case "pagedown":
		return model.MsgPageDown{}, true
	}
	return nil, false
}
