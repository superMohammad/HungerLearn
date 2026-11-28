/** Text with only its digit runs in the monospace `.num` style, so Arabic words keep the body font. Usable on server and client. */
export function NumText({ text }: { text: string }) {
  return <>{text.split(/(\d+)/).map((part, i) => (i % 2 === 1 ? <span key={i} className="num">{part}</span> : part))}</>;
}
