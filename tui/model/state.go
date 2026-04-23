package model

import (
	"os"
	"strings"
	"time"
)

// MessageType distinguishes user, assistant, system, tool messages.
type MessageType int

const (
	MsgTypeUser MessageType = iota
	MsgTypeAssistant
	MsgTypeSystem
	MsgTypeToolUse
	MsgTypeToolResult
	MsgTypeProgress
)

// ToolCall represents a tool invocation.
type ToolCall struct {
	Name   string
	Input  map[string]any
	Output string
	Status ToolStatus
}

// ToolStatus indicates whether a tool call is pending/completed/failed.
type ToolStatus int

const (
	ToolStatusPending ToolStatus = iota
	ToolStatusCompleted
	ToolStatusFailed
)

// Message represents a single message in the conversation.
type Message struct {
	ID          string
	Type        MessageType
	Content     string
	Timestamp   time.Time
	Model       string // e.g. "claude-opus-4.6"
	ToolCalls   []ToolCall
	IsStreaming bool
	IsError     bool
}

// AppContext is the active keybinding context.
type AppContext int

const (
	CtxGlobal AppContext = iota
	CtxChat
	CtxAutocomplete
	CtxConfirmation
	CtxSettings
	CtxSelect
	CtxHistorySearch
)

// InputMode controls how the composer interprets submitted input.
type InputMode int

const (
	InputModeAgent InputMode = iota
	InputModeShell
	InputModeCouncil
	InputModeMedia
)

func (m InputMode) String() string {
	switch m {
	case InputModeShell:
		return "SHELL"
	case InputModeCouncil:
		return "COUNCIL"
	case InputModeMedia:
		return "MEDIA"
	default:
		return "AGENT"
	}
}

func (m InputMode) Next() InputMode {
	switch m {
	case InputModeAgent:
		return InputModeShell
	case InputModeShell:
		return InputModeCouncil
	case InputModeCouncil:
		return InputModeMedia
	default:
		return InputModeAgent
	}
}

// Screen identifies the active full-screen view.
type Screen int

const (
	ScreenREPL Screen = iota
	ScreenWelcome
	ScreenResume
	ScreenDoctor
	ScreenSettings
	ScreenModelPicker
)

// PermissionRequest is a pending tool permission prompt.
type PermissionRequest struct {
	ID       string
	ToolName string
	Input    map[string]any
	Meta     string
}

// PermissionMode controls how tool permissions are handled.
type PermissionMode int

const (
	PermModeReviewTools PermissionMode = iota
	PermModeAcceptAll
	PermModeBypass
)

// FooterItem is a single key=value entry in the status bar.
type FooterItem struct {
	Key   string
	Value string
}

// TokenUsage tracks token consumption for the session.
type TokenUsage struct {
	InputTokens  int
	OutputTokens int
}

// AppState holds all session state.
type AppState struct {
	// Identity
	SessionID   string
	WorkingDir  string
	ProjectRoot string

	// Messages
	Messages      []Message
	PendingStream *Message // partial assistant message being streamed
	InputHistory  []string
	HistoryIndex  int

	// Input
	InputText string
	InputMode InputMode

	// UI
	ActiveScreen Screen
	DialogOpen   bool
	IsLoading    bool
	IsCancelled  bool
	IsThinking   bool
	IsSuspended  bool
	IsFastMode   bool
	IsVimMode    bool

	// Permissions
	PermissionMode    PermissionMode
	PendingPermission *PermissionRequest

	// Model
	Model         string
	ModelNickname string

	// Status
	FooterItems []FooterItem
	StatusMsg   string

	// Cost
	TotalCostUSD     float64
	TotalAPIDuration time.Duration
	TokenUsage       TokenUsage

	// Tasks
	ActiveTaskCount int

	// Bridge
	BridgeConnected bool
}

// NewAppState creates the default app state.
func NewAppState() AppState {
	return AppState{
		ActiveScreen:    ScreenREPL,
		PermissionMode:  PermModeReviewTools,
		Model:           detectInitialModel(),
		Messages:        []Message{},
		InputHistory:    []string{},
		FooterItems:     []FooterItem{},
		BridgeConnected: false,
		InputMode:       InputModeAgent,
		IsLoading:       false,
		IsThinking:      false,
		IsSuspended:     false,
		IsFastMode:      false,
		IsVimMode:       false,
		DialogOpen:      false,
		IsCancelled:     false,
	}
}

func detectInitialModel() string {
	for _, key := range []string{
		"DUCKHIVE_MODEL",
		"OPENAI_MODEL",
		"GEMINI_MODEL",
		"ANTHROPIC_MODEL",
		"CLAUDE_MODEL",
		"MINIMAX_MODEL",
	} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return "auto"
}
