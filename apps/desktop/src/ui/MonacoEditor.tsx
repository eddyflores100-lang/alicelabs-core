import Editor, { loader } from "@monaco-editor/react";

loader.config({ paths: { vs: new URL("vs", window.location.href).toString() } });

type Props = { value: string; language: string; onChange: (value: string) => void };

export default function MonacoEditor({ value, language, onChange }: Props) {
  return (
    <Editor
      height="100%"
      language={language}
      theme="vs-dark"
      value={value}
      onChange={(next) => onChange(next ?? "")}
      options={{
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: "Cascadia Code, Consolas, monospace",
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        smoothScrolling: false,
        tabSize: 2,
        wordWrap: "off",
        padding: { top: 14 },
        renderLineHighlight: "line",
        renderWhitespace: "selection",
        cursorBlinking: "solid",
        overviewRulerBorder: false,
        scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
      }}
    />
  );
}
