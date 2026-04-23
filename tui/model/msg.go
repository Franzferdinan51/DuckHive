package model

import (
	"github.com/charmbracelet/bubbletea"
)

// ============================================================
// OUTBOUND MESSAGES (keyboard / user actions -> Update)
// ============================================================

// OutMsg is the union of all messages sent to Update from the UI.
type OutMsg interface {
	outMsg()
}

// --- Screen Navigation ---

type MsgNavigate struct {
	Screen Screen
}

type MsgPushDialog struct{}

type MsgPopDialog struct{}

// --- Input ---

// MsgInputChanged fires on every keystroke in the input field.
type MsgInputChanged struct {
	Value string
}

// MsgInputSubmitted fires on Enter.
type MsgInputSubmitted struct{}

// MsgHistoryUp / MsgHistoryDown navigate command history.
type MsgHistoryUp struct{}
type MsgHistoryDown struct{}

// MsgCancelInput clears the current input and cancels pending state.
type MsgCancelInput struct{}

// --- Keyboard shortcuts ---

// MsgInterrupt (ctrl+c) cancels an in-flight request.
type MsgInterrupt struct{}

// MsgExit (ctrl+d) quits the program.
type MsgExit struct{}

// MsgRedraw (ctrl+l) forces a full redraw.
type MsgRedraw struct{}

// MsgToggleTodos (ctrl+t) toggles the task list panel.
type MsgToggleTodos struct{}

// MsgToggleTranscript (ctrl+o) toggles transcript view.
type MsgToggleTranscript struct{}

// MsgToggleFastMode (ctrl+shift+f) toggles fast (speculative) mode.
type MsgToggleFastMode struct{}

// MsgToggleShellMode (ctrl+x) toggles the shell composer mode.
type MsgToggleShellMode struct{}

// MsgConfirmYes is used in confirmation dialogs (enter/y).
type MsgConfirmYes struct{}

// MsgConfirmNo is used in confirmation dialogs (n/escape).
type MsgConfirmNo struct{}

// MsgSuspend (ctrl+z) suspends the session.
type MsgSuspend struct{}

// MsgPageUp scrolls message list up.
type MsgPageUp struct{}

// MsgPageDown scrolls message list down.
type MsgPageDown struct{}

// MsgModelPicker opens the model picker.
type MsgModelPicker struct{}

// MsgCycleMode (shift+tab) cycles input mode (standard/vim/shell).
type MsgCycleMode struct{}

// MsgExternalEditor (ctrl+x ctrl+e) opens $EDITOR.
type MsgExternalEditor struct{}

// MsgUndo (ctrl+_) undoes last input action.
type MsgUndo struct{}

// --- Message actions ---

// MsgSelectMessage highlights a message for actions.
type MsgSelectMessage struct {
	ID string
}

// MsgMessageAction performs an action on a selected message.
type MsgMessageAction struct {
	ID     string
	Action string // "copy", "edit", "delete", "regenerate"
}

// --- Permission ---

type MsgPermissionResponse struct {
	RequestID string
	Approved  bool
}

// --- Window ---

// MsgWindowSize updates layout dimensions.
type MsgWindowSize struct {
	Width  int
	Height int
}

// ============================================================
// INBOUND MESSAGES (bridge / network -> Update)
// ============================================================

// InMsg is messages arriving from the backend bridge.
type InMsg interface {
	inMsg()
}

// MsgBridgeConnected signals the Unix socket bridge is up.
type MsgBridgeConnected struct{}

// MsgBridgeDisconnected signals bridge failure.
type MsgBridgeDisconnected struct {
	Err error
}

// MsgMessageReceived is a complete message from the backend.
type MsgMessageReceived struct {
	Message Message
}

// MsgStreamDelta is a chunk of streaming text for a pending message.
type MsgStreamDelta struct {
	MessageID string
	Delta     string
}

// MsgStreamEnd marks a streaming message as complete.
type MsgStreamEnd struct {
	MessageID string
}

// MsgThinkingStarted indicates the model is thinking.
type MsgThinkingStarted struct{}

// MsgThinkingEnded stops the thinking indicator.
type MsgThinkingEnded struct{}

// MsgPermissionRequest is a tool permission prompt.
type MsgPermissionRequest struct {
	Request PermissionRequest
}

// MsgStatusUpdate sets a transient status message.
type MsgStatusUpdate struct {
	Message string
}

// MsgModelChanged updates the active model label from the backend.
type MsgModelChanged struct {
	Model string
}

// MsgError surfaces an error to the UI.
type MsgError struct {
	Err error
}

// MsgTaskStarted signals a background task began.
type MsgTaskStarted struct {
	ID   string
	Desc string
}

// MsgTaskEnded signals a background task finished.
type MsgTaskEnded struct {
	ID string
}

// MsgTokensReceived updates token usage stats.
type MsgTokensReceived struct {
	Usage TokenUsage
}

// MsgCostReceived updates running cost tally.
type MsgCostReceived struct {
	Cost float64
}

// --- Stub implementations so types satisfy interfaces ---

func (MsgNavigate) outMsg()           {}
func (MsgPushDialog) outMsg()         {}
func (MsgPopDialog) outMsg()          {}
func (MsgInputChanged) outMsg()       {}
func (MsgInputSubmitted) outMsg()     {}
func (MsgHistoryUp) outMsg()          {}
func (MsgHistoryDown) outMsg()        {}
func (MsgCancelInput) outMsg()        {}
func (MsgInterrupt) outMsg()          {}
func (MsgExit) outMsg()               {}
func (MsgRedraw) outMsg()             {}
func (MsgToggleTodos) outMsg()        {}
func (MsgToggleTranscript) outMsg()   {}
func (MsgToggleFastMode) outMsg()     {}
func (MsgToggleShellMode) outMsg()    {}
func (MsgConfirmYes) outMsg()         {}
func (MsgConfirmNo) outMsg()          {}
func (MsgSuspend) outMsg()            {}
func (MsgPageUp) outMsg()             {}
func (MsgPageDown) outMsg()           {}
func (MsgModelPicker) outMsg()        {}
func (MsgCycleMode) outMsg()          {}
func (MsgExternalEditor) outMsg()     {}
func (MsgUndo) outMsg()               {}
func (MsgSelectMessage) outMsg()      {}
func (MsgMessageAction) outMsg()      {}
func (MsgPermissionResponse) outMsg() {}
func (MsgWindowSize) outMsg()         {}

func (MsgBridgeConnected) inMsg()    {}
func (MsgBridgeDisconnected) inMsg() {}
func (MsgMessageReceived) inMsg()    {}
func (MsgStreamDelta) inMsg()        {}
func (MsgStreamEnd) inMsg()          {}
func (MsgThinkingStarted) inMsg()    {}
func (MsgThinkingEnded) inMsg()      {}
func (MsgPermissionRequest) inMsg()  {}
func (MsgStatusUpdate) inMsg()       {}
func (MsgModelChanged) inMsg()       {}
func (MsgError) inMsg()              {}
func (MsgTaskStarted) inMsg()        {}
func (MsgTaskEnded) inMsg()          {}
func (MsgTokensReceived) inMsg()     {}
func (MsgCostReceived) inMsg()       {}

// compile-time interface compliance checks
var (
	_ OutMsg = MsgNavigate{}
	_ OutMsg = MsgInputSubmitted{}
	_ OutMsg = MsgInterrupt{}
	_ OutMsg = MsgExit{}

	_ InMsg = MsgBridgeConnected{}
	_ InMsg = MsgMessageReceived{}
	_ InMsg = MsgStreamDelta{}
)

// -- TeaMsg adapter --
// MsgToTea converts our message types into tea.Msg for Bubble Tea.
type MsgToTea struct {
	Inner tea.Msg
}

func (m MsgToTea) Type() string {
	return "tea"
}
