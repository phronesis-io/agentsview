package parser

import (
	"testing"

	"github.com/tidwall/gjson"
)

func TestCodexExecScript(t *testing.T) {
	in := "const r = await tools.exec_command({\n  cmd: \"sed -n '1,2p' a.md\",\n  workdir: \"/x\"});\ntext(await tools.exec_command({cmd:\"echo \\\"hi\\\"\"}));"
	got := gjson.Parse(codexExecScriptInputJSON(in))
	if got.Get("cmd").Str != "sed -n '1,2p' a.md\necho \"hi\"" || got.Get("workdir").Str != "/x" {
		t.Fatalf("got %s", got.Raw)
	}
	p := gjson.Parse(codexExecScriptInputJSON(`text(await tools.apply_patch("*** Begin Patch\n*** Update File: /a/b.py\n@@"));`))
	if p.Get("cmd").Str != "apply_patch /a/b.py" {
		t.Fatalf("got %s", p.Raw)
	}
	out := gjson.Parse(`[{"type":"input_text","text":"Script completed\nOutput:\n"},{"type":"input_text","text":"{\"exit_code\":0,\"output\":\"# Hi\\nline\"}"}]`)
	flat, ok := codexFlattenOutputBlocks(out)
	if !ok || flat != "Script completed\nOutput:\n[exit_code 0]\n# Hi\nline" {
		t.Fatalf("got %q", flat)
	}
}
