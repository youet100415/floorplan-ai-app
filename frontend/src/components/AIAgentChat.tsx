"use client";

/** Finch Archie 스타일 채팅 UI — 자연어로 링크 유닛 문/점수 제어. */

import { useEffect, useRef, useState } from "react";
import type { AgentMessage } from "@/utils/interior/agent";

interface Props {
  messages: AgentMessage[];
  busy: boolean;
  disabled?: boolean;
  disabledHint?: string;
  onSend: (text: string) => void;
}

const SUGGESTIONS = [
  "모든 욕실·현관 문을 스윙으로 바꿔줘. 욕실 34인치, 현관 36인치",
  "욕실 문을 30인치 여닫이로",
  "점수 요약",
  "타입별 자동 배치",
];

export default function AIAgentChat({
  messages,
  busy,
  disabled,
  disabledHint,
  onSend,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const submit = (text: string) => {
    const t = text.trim();
    if (!t || busy || disabled) return;
    onSend(t);
    setPrompt("");
  };

  return (
    <div className="archieChat">
      <div className="archieHead">
        <div className="archieAvatar" aria-hidden>
          A
        </div>
        <div>
          <strong>Archie</strong>
          <em>AI agent · 링크 유닛 정밀 수정</em>
        </div>
      </div>

      <div className="archieHistory">
        {messages.length === 0 && (
          <div className="archieEmpty">
            <p>
              영상처럼 자연어로 문을 일괄 변경할 수 있습니다.
              <br />
              내부 템플릿이 적용된 유닛을 대상으로 합니다.
            </p>
            <div className="archieSuggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="suggestChip"
                  disabled={disabled || busy}
                  onClick={() => submit(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`archieBubble ${msg.role}`}>
            <div className="archieBubbleMeta">
              {msg.role === "user" ? "You" : "Archie"}
            </div>
            <p className="archieText">{msg.text}</p>
            {msg.details && msg.details.length > 0 && (
              <ul className="archieDetails">
                {msg.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
            {msg.summaryCard && (
              <div className="archieCard">
                <strong>{msg.summaryCard.title}</strong>
                <ul>
                  {msg.summaryCard.changes.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
                {msg.summaryCard.unitIds.length > 0 && (
                  <p className="archieCardFoot">
                    Units: {msg.summaryCard.unitIds.slice(0, 8).join(", ")}
                    {msg.summaryCard.unitIds.length > 8
                      ? ` +${msg.summaryCard.unitIds.length - 8}`
                      : ""}
                  </p>
                )}
                {msg.summaryCard.doorCounts && (
                  <p className="archieCardFoot">
                    Doors updated: bath {msg.summaryCard.doorCounts.bathroom ?? 0} ·
                    entry {msg.summaryCard.doorCounts.entrance ?? 0} · total{" "}
                    {msg.summaryCard.doorCounts.total ?? 0}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="archieBubble agent">
            <div className="archieBubbleMeta">Archie</div>
            <p className="archieText pulse">도면 정밀 수정 연산 중…</p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {disabled && disabledHint && (
        <p className="note warn archieDisabled">{disabledHint}</p>
      )}

      <form
        className="archieForm"
        onSubmit={(e) => {
          e.preventDefault();
          submit(prompt);
        }}
      >
        <input
          type="text"
          value={prompt}
          disabled={busy || disabled}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="예: 모든 욕실 문을 34인치 여닫이문으로 바꿔줘"
        />
        <button type="submit" className="primary" disabled={busy || disabled || !prompt.trim()}>
          전송
        </button>
      </form>
    </div>
  );
}
