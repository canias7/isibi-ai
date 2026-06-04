import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Renders assistant replies as Markdown (GFM: tables, lists, links, code).
// react-markdown does not render raw HTML, so this is XSS-safe by default.
export default function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Open links in the system browser, safely.
          a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
