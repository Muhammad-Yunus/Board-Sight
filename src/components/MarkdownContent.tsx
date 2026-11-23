import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className = '' }: MarkdownContentProps) {
  return (
    <div className={`text-[12.5px] text-[#1F2937] leading-relaxed space-y-2 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-[14.5px] font-semibold text-[#111827] mt-3 mb-1.5 first:mt-0 border-b border-[#EAECEF] pb-1">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-[13.5px] font-semibold text-[#111827] mt-3 mb-1 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[12.5px] font-semibold text-[#111827] mt-2.5 mb-1 first:mt-0">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-[12px] font-semibold text-[#374151] mt-2 mb-1 first:mt-0">
              {children}
            </h4>
          ),
          p: ({ children }) => <p className="leading-relaxed last:mb-0">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-semibold text-[#111827]">{children}</strong>
          ),
          em: ({ children }) => <em className="italic text-[#374151]">{children}</em>,
          ul: ({ children }) => (
            <ul className="list-disc pl-5 space-y-1 my-1.5 text-[#1F2937]">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 space-y-1 my-1.5 text-[#1F2937]">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed pl-0.5">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-[#5AC16D] bg-[#F7FBF8] px-3 py-1.5 rounded-r-md text-[#374151] my-2">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-t border-[#EAECEF] my-2.5" />,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#2563EB] hover:underline font-medium break-words"
            >
              {children}
            </a>
          ),
          code: ({ className: codeClassName, children }) => {
            const isBlock = Boolean(codeClassName && codeClassName.startsWith('language-'));
            if (isBlock) {
              return (
                <code className="block font-mono-tabular text-[11.5px] text-[#111827] whitespace-pre">
                  {children}
                </code>
              );
            }
            return (
              <code className="font-mono-tabular text-[11.5px] bg-[#F3F4F6] text-[#111827] border border-[#E5E7EB] rounded px-1 py-0.5">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="overflow-x-auto bg-[#F9FAFB] border border-[#EAECEF] rounded-lg p-2.5 my-2 text-[11.5px]">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2 rounded-lg border border-[#EAECEF]">
              <table className="w-full border-collapse text-left text-[11.5px]">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[#F9FAFB] border-b border-[#EAECEF] text-[#374151]">
              {children}
            </thead>
          ),
          tbody: ({ children }) => <tbody className="divide-y divide-[#F1F3F5]">{children}</tbody>,
          tr: ({ children }) => <tr className="hover:bg-[#FAFAFB]">{children}</tr>,
          th: ({ children }) => (
            <th className="px-2.5 py-1.5 font-semibold text-[#111827] whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-2.5 py-1.5 text-[#374151] align-top">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
