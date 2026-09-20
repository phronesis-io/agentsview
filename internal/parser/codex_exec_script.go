package parser

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"

	"github.com/tidwall/gjson"
)

// Codex "code mode" wraps every tool call in a JavaScript
// snippet passed to a custom tool named "exec", e.g.
//
//	text(await tools.exec_command({cmd:"ls", workdir:"/x"}));
//
// The snippet is not JSON, so the UI cannot show the command. These helpers
// pull the shell commands out of the snippet into a JSON object the UI
// understands, and flatten the input_text output blocks into plain text.

var (
	codexExecToolRe    = regexp.MustCompile(`\btools\.(\w+)\(`)
	codexExecCmdRe     = regexp.MustCompile(`["']?\bcmd["']?\s*:\s*("(?:[^"\\]|\\.)*")`)
	codexExecWorkdirRe = regexp.MustCompile(`["']?\bworkdir["']?\s*:\s*("(?:[^"\\]|\\.)*")`)
	codexExecCharsRe   = regexp.MustCompile(`["']?\bchars["']?\s*:\s*("(?:[^"\\]|\\.)*")`)
	codexExecSessionRe = regexp.MustCompile(`["']?\bsession_id["']?\s*:\s*(\d+)`)
	codexPatchFileRe   = regexp.MustCompile(`\*\*\* (?:Update|Add|Delete) File: ([^\\\n"]+)`)
)

func codexUnquoteJS(lit string) string {
	var s string
	if err := json.Unmarshal([]byte(lit), &s); err == nil {
		return s
	}
	if s, err := strconv.Unquote(lit); err == nil {
		return s
	}
	return strings.Trim(lit, `"`)
}

// codexExecScriptInputJSON converts a code-mode exec snippet to a JSON
// object with a "cmd" summary plus the original "script". It returns the
// input unchanged when it is empty or already valid JSON.
func codexExecScriptInputJSON(script string) string {
	trimmed := strings.TrimSpace(script)
	if trimmed == "" || gjson.Valid(trimmed) {
		return script
	}

	var cmds []string
	for _, m := range codexExecCmdRe.FindAllStringSubmatch(trimmed, -1) {
		cmds = append(cmds, codexUnquoteJS(m[1]))
	}

	var tools []string
	seen := map[string]bool{}
	for _, m := range codexExecToolRe.FindAllStringSubmatch(trimmed, -1) {
		if !seen[m[1]] {
			seen[m[1]] = true
			tools = append(tools, m[1])
		}
	}

	if len(cmds) == 0 {
		switch {
		case seen["apply_patch"]:
			var files []string
			for _, m := range codexPatchFileRe.FindAllStringSubmatch(trimmed, -1) {
				files = append(files, strings.TrimSpace(m[1]))
			}
			cmds = append(cmds, "apply_patch "+strings.Join(files, " "))
		case seen["write_stdin"]:
			line := "write_stdin"
			if m := codexExecSessionRe.FindStringSubmatch(trimmed); m != nil {
				line += " session=" + m[1]
			}
			if m := codexExecCharsRe.FindStringSubmatch(trimmed); m != nil {
				if chars := codexUnquoteJS(m[1]); chars != "" {
					line += " " + strconv.Quote(chars)
				} else {
					line += " (poll output)"
				}
			}
			cmds = append(cmds, line)
		default:
			first := strings.SplitN(trimmed, "\n", 2)[0]
			if len(first) > 300 {
				first = first[:300] + "…"
			}
			cmds = append(cmds, first)
		}
	}

	out := map[string]any{
		"cmd":    strings.Join(cmds, "\n"),
		"script": script,
	}
	if len(tools) > 0 {
		out["tools"] = strings.Join(tools, ", ")
	}
	if m := codexExecWorkdirRe.FindStringSubmatch(trimmed); m != nil {
		out["workdir"] = codexUnquoteJS(m[1])
	}
	b, err := json.Marshal(out)
	if err != nil {
		return script
	}
	return string(b)
}

// codexFlattenOutputBlocks turns an array of {type:input_text,text:...}
// output blocks into readable text. Blocks whose text is a JSON object
// carrying an "output" string (the exec_command result envelope) are
// replaced by that output. ok is false when raw is not such an array.
func codexFlattenOutputBlocks(output gjson.Result) (string, bool) {
	if !output.IsArray() {
		return "", false
	}
	var parts []string
	for _, block := range output.Array() {
		text := block.Get("text")
		if !block.IsObject() || text.Type != gjson.String {
			return "", false
		}
		parts = append(parts, codexUnwrapExecEnvelope(text.Str))
	}
	if len(parts) == 0 {
		return "", false
	}
	return strings.TrimSpace(strings.Join(parts, "")), true
}

func codexUnwrapExecEnvelope(text string) string {
	idx := strings.Index(text, "{")
	if idx < 0 {
		return text
	}
	prefix, body := text[:idx], strings.TrimSpace(text[idx:])
	if !gjson.Valid(body) {
		return text
	}
	env := gjson.Parse(body)
	out := env.Get("output")
	if !env.IsObject() || out.Type != gjson.String {
		return text
	}
	var sb strings.Builder
	sb.WriteString(prefix)
	if code := env.Get("exit_code"); code.Exists() {
		sb.WriteString("[exit_code " + code.Raw + "]\n")
	} else if sid := env.Get("session_id"); sid.Exists() {
		sb.WriteString("[still running, session " + sid.Raw + "]\n")
	}
	sb.WriteString(out.Str)
	if !strings.HasSuffix(out.Str, "\n") {
		sb.WriteString("\n")
	}
	return sb.String()
}
