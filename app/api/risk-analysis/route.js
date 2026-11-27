import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const readHoldings = (value) => {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error('Provide no more than 100 active holdings for analysis.');
  }

  return value.map((holding) => {
    if (
      typeof holding !== 'object' ||
      holding === null ||
      typeof holding.ticker !== 'string' ||
      !/^[A-Za-z0-9.^=_-]{1,20}$/.test(holding.ticker.trim()) ||
      (holding.side !== 'LONG' && holding.side !== 'SHORT') ||
      typeof holding.company !== 'string' ||
      typeof holding.currency !== 'string' ||
      !isFiniteNumber(holding.quantity) ||
      !isFiniteNumber(holding.averageCost) ||
      !isFiniteNumber(holding.marketPrice) ||
      !isFiniteNumber(holding.marketValue) ||
      !isFiniteNumber(holding.unrealizedPL)
    ) {
      throw new Error('A holding has invalid or incomplete risk-analysis fields.');
    }

    return {
      ticker: holding.ticker.trim().toUpperCase(),
      company: holding.company.slice(0, 120),
      quantity: holding.quantity,
      side: holding.side,
      averageCost: holding.averageCost,
      marketPrice: holding.marketPrice,
      marketValue: holding.marketValue,
      unrealizedPL: holding.unrealizedPL,
      currency: holding.currency.slice(0, 3).toUpperCase(),
    };
  });
};

export async function POST(request) {
  try {
    const authorization = request.headers.get('authorization');
    const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!accessToken) {
      return NextResponse.json({ error: 'Sign in to generate a portfolio risk report.' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase authentication is not configured on the server.');
    }
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user) {
      return NextResponse.json({ error: 'Your session is invalid or expired. Please sign in again.' }, { status: 401 });
    }

    const body = await request.json();
    const holdings = readHoldings(body?.holdings);

    // Automatically normalize backend URL to safely handle root base urls or full paths
    const rawEnvUrl = process.env.RISK_ANALYSIS_API_URL || 'http://127.0.0.1:8000';
    const backendUrl = rawEnvUrl.endsWith('/api/analyze')
      ? rawEnvUrl
      : `${rawEnvUrl.replace(/\/+$/, '')}/api/analyze`;

    const backendResponse = await fetch(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tickers: [...new Set(holdings.map((holding) => holding.ticker))],
        holdings,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(90000),
    });

    const responseText = await backendResponse.text();
    let analysisData;
    try {
      analysisData = JSON.parse(responseText);
    } catch {
      throw new Error(`The risk analysis service returned an invalid response (${backendResponse.status}).`);
    }

    if (!backendResponse.ok) {
      const backendMessage = typeof analysisData?.detail === 'string'
        ? analysisData.detail
        : typeof analysisData?.error === 'string'
          ? analysisData.error
          : `The risk analysis service failed (${backendResponse.status}).`;
      return NextResponse.json({ error: backendMessage }, { status: 502 });
    }

    return NextResponse.json(analysisData);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate the risk report.';
    const isConnectionError = error instanceof TypeError && message.toLowerCase().includes('fetch');
    const status = isConnectionError
      ? 503
      : error instanceof SyntaxError || message.includes('holding') || message.includes('Provide')
      ? 400
      : message.toLowerCase().includes('timeout') || message.toLowerCase().includes('timed out') || message.includes('aborted')
        ? 504
        : 502;
    return NextResponse.json({
      error: isConnectionError
        ? 'The FastAPI risk service is not reachable. Start it on port 8000 and try again.'
        : message,
    }, { status });
  }
}