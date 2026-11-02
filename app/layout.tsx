import type { Metadata } from 'next';
import { AuthProvider } from '@/components/AuthProvider';
import './globals.css';
import './responsive.css';
export const metadata: Metadata = { title: 'Northstar | Portfolio', description: 'Personal investment portfolio tracker' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><AuthProvider>{children}</AuthProvider></body></html>; }
