import React from 'react';
import { ChevronRightIcon } from './Icons';

export interface BreadcrumbItem {
  label: string;
  onClick?: () => void;
  isCurrent?: boolean;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ items }) => {
  return (
    <nav aria-label="Breadcrumb">
      <ol
        style={{
          display: 'flex',
          alignItems: 'center',
          listStyle: 'none',
          margin: 0,
          padding: 0,
          gap: '6px',
        }}
      >
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <React.Fragment key={index}>
              <li>
                {item.onClick && !isLast ? (
                  <button
                    type="button"
                    onClick={item.onClick}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      fontSize: '13px',
                      color: 'var(--text-secondary, #BAB3C5)',
                      cursor: 'pointer',
                      outline: 'none',
                    }}
                  >
                    {item.label}
                  </button>
                ) : (
                  <span
                    aria-current={isLast ? 'page' : undefined}
                    style={{
                      fontSize: '13px',
                      fontWeight: isLast ? 600 : 400,
                      color: isLast ? 'var(--text-primary, #F3F0F6)' : 'var(--text-secondary, #BAB3C5)',
                    }}
                  >
                    {item.label}
                  </span>
                )}
              </li>
              {!isLast && (
                <li aria-hidden="true" style={{ color: 'var(--text-tertiary, #877E94)', display: 'flex' }}>
                  <ChevronRightIcon size={14} />
                </li>
              )}
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
};
