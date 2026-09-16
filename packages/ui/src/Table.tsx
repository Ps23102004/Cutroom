import React from 'react';

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  children: React.ReactNode;
}

export const Table: React.FC<TableProps> = ({ children, style, className = '', ...props }) => (
  <div style={{ width: '100%', overflowX: 'auto' }}>
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        textAlign: 'left',
        fontSize: '13px',
        color: 'var(--text-primary, #FAF8FF)',
        ...style,
      }}
      className={`cutroom-table ${className}`}
      {...props}
    >
      {children}
    </table>
  </div>
);

export const TableHead: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({ children, style, ...props }) => (
  <thead
    style={{
      backgroundColor: 'var(--bg-panel, #0F0F16)',
      borderBottom: '1px solid var(--border-default, #2A2A3A)',
      ...style,
    }}
    {...props}
  >
    {children}
  </thead>
);

export const TableBody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({ children, ...props }) => (
  <tbody {...props}>{children}</tbody>
);

export const TableRow: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = ({ children, style, ...props }) => (
  <tr
    style={{
      borderBottom: '1px solid var(--border-subtle, #1E1E2A)',
      transition: 'background-color 100ms ease',
      ...style,
    }}
    {...props}
  >
    {children}
  </tr>
);

export const TableHeaderCell: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({ children, style, ...props }) => (
  <th
    style={{
      padding: '10px 14px',
      fontSize: '12px',
      fontWeight: 600,
      color: 'var(--text-secondary, #C2BCCC)',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      ...style,
    }}
    {...props}
  >
    {children}
  </th>
);

export const TableCell: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({ children, style, ...props }) => (
  <td
    style={{
      padding: '12px 14px',
      fontSize: '13px',
      color: 'var(--text-primary, #FAF8FF)',
      verticalAlign: 'middle',
      ...style,
    }}
    {...props}
  >
    {children}
  </td>
);
