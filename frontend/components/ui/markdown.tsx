import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/cn';

/**
 * Lesson and explanation bodies. Headings inside a section start at h3 so the
 * document outline stays correct wherever the markdown is dropped in.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('prose-lesson', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children: content }) => <h3>{content}</h3>,
          h2: ({ children: content }) => <h3>{content}</h3>,
          h3: ({ children: content }) => <h4>{content}</h4>,
          a: ({ href, children: content }) => (
            <a href={href} rel="noreferrer noopener" target="_blank">
              {content}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
