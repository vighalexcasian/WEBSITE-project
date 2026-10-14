import type { Metadata } from 'next';
import './globals.css';
import './responsive.css';
export const metadata: Metadata = { title: 'Northstar | Portfolio', description: 'Personal investment portfolio tracker' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
