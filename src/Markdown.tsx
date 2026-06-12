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
          // A model-emitted image is still a remote fetch — never let it carry
          // the app's URL out via Referer (tracking-pixel-by-prompt-injection).
          img: ({ node: _n, ...props }) => <img {...props} referrerPolicy="no-referrer" loading="lazy" />,
          // Let wide tables scroll horizontally instead of crushing columns.
          table: ({ node: _n, ...props }) => (
            <div className="md-table-wrap">
              <table {...props} />
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
