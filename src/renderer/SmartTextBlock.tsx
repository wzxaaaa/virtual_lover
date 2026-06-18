import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { openExternalUrl } from './openExternal';

function ExternalAnchor(props: React.ComponentPropsWithoutRef<'a'>) {
  const { href, onClick, children, ...rest } = props;
  return (
    <a
      {...rest}
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        if (onClick) onClick(event);
        if (event.defaultPrevented) return;
        if (!href) return;
        event.preventDefault();
        openExternalUrl(href);
      }}
    >
      {children}
    </a>
  );
}

function looksLikeRichText(text: string) {
  return (
    /```[\s\S]*```/.test(text) ||
    /`[^`\n]+`/.test(text) ||
    /(?:^|\n)\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+\.\s|>\s)/.test(text) ||
    /\[[^\]]+\]\((https?:\/\/|\/)[^)]+\)/.test(text) ||
    /(?:^|\n)\|.+\|.+(?:\n|\r\n)\|(?:[-: ]+\|){1,}/.test(text) ||
    /\$\$[\s\S]+?\$\$/.test(text) ||
    /(?<!\$)\$(?!\$)[^$\n]+(?<!\$)\$(?!\$)/.test(text) ||
    /https?:\/\/\S+/.test(text)
  );
}

function CodeBlock({
  inline,
  className,
  children
}: {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const language = className?.replace(/^language-/, '') || '';
  const content = String(children ?? '').replace(/\n$/, '');
  const isInline = inline ?? (!className && !content.includes('\n'));

  if (isInline) {
    return <code className="message-markdown-inline-code">{content}</code>;
  }

  return (
    <div className="message-code-block">
      {language ? <div className="message-code-language">{language}</div> : null}
      <pre className="message-markdown-pre">
        <code className={className}>{content}</code>
      </pre>
    </div>
  );
}

function StreamingText({ text }: { text: string }) {
  const [settledLen, setSettledLen] = useState(0);
  const textLenRef = useRef(text.length);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  textLenRef.current = text.length;

  useEffect(() => {
    if (textLenRef.current > settledLen && timerRef.current === null) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setSettledLen(textLenRef.current);
      }, 200);
    }
  });

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    []
  );

  const fresh = text.slice(settledLen);

  if (!fresh) {
    return <div className="message-block message-block-text">{text}</div>;
  }

  return (
    <div className="message-block message-block-text">
      {text.slice(0, settledLen)}
      <span key={settledLen} className="text-chunk-reveal">
        {fresh}
      </span>
    </div>
  );
}

export default function SmartTextBlock({
  text,
  isStreaming,
  disableStreamingReveal
}: {
  text: string;
  isStreaming?: boolean;
  disableStreamingReveal?: boolean;
}) {
  if (isStreaming && disableStreamingReveal) {
    return <div className="message-block message-block-text">{text}</div>;
  }

  if (isStreaming) {
    return <StreamingText text={text} />;
  }

  if (!looksLikeRichText(text)) {
    return <div className="message-block message-block-text">{text}</div>;
  }

  return (
    <div className="message-block message-block-markdown" data-render-mode="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code: CodeBlock,
          a: ExternalAnchor
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
