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

const resolveBackendUrl = (configuredUrl) => {
  const rawUrl = configuredUrl.trim();
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('RISK_ANALYSIS_API_URL must be an absolute HTTP(S) URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('RISK_ANALYSIS_API_URL must use HTTP or HTTPS.');
  }
  if (
    process.env.NODE_ENV === 'production' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())
  ) {
    throw new Error('RISK_ANALYSIS_API_URL cannot use a loopback address in production. Set it to the deployed FastAPI service URL.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('RISK_ANALYSIS_API_URL must not contain credentials, a query, or a fragment.');
  }

  const pathname = url.pathname.replace(/\/+$/, '');
  if (/\/api\/analyze$/i.test(pathname)) {
    url.pathname = pathname;
  } else if (/\/api$/i.test(pathname)) {
    url.pathname = `${pathname}/analyze`;
  } else {
    url.pathname = `${pathname}/api/analyze`;
  }

  return url.toString();
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

    const configuredBackendUrl = process.env.RISK_ANALYSIS_API_URL?.trim();
    if (!configuredBackendUrl && process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'RISK_ANALYSIS_API_URL is not set in production. Set it to the deployed FastAPI service URL in Render.' },
        { status: 500 },
      );
    }
    const backendUrl = resolveBackendUrl(configuredBackendUrl || 'http://127.0.0.1:8000');

    let backendResponse;
    try {
      backendResponse = await fetch(backendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tickers: [...new Set(holdings.map((holding) => holding.ticker))],
          holdings,
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(90000),
      });
    } catch (error) {
      console.error('Risk-analysis backend request failed:', {
        url: backendUrl,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const responseText = await backendResponse.text();
    const contentType = backendResponse.headers.get('content-type') || 'unknown content type';
    let analysisData = null;
    try {
      analysisData = JSON.parse(responseText);
    } catch {
      if (backendResponse.ok) {
        console.error('Risk-analysis backend returned a non-JSON success response:', {
          url: backendUrl,
          status: backendResponse.status,
          contentType,
        });
        return NextResponse.json(
          { error: `The risk analysis service returned HTTP ${backendResponse.status} with ${contentType}, not JSON. Check the FastAPI route and deployment configuration.` },
          { status: 502 },
        );
      }
    }

    if (!backendResponse.ok) {
      const detail = analysisData?.detail;
      const backendMessage = typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((item) => typeof item?.msg === 'string' ? item.msg : JSON.stringify(item)).join('; ')
          : typeof analysisData?.error === 'string'
            ? analysisData.error
            : '';
      const pathHint = backendResponse.status === 404
        ? ' Verify RISK_ANALYSIS_API_URL is the FastAPI base URL or the exact /api/analyze endpoint.'
        : '';
      const errorMessage = backendMessage || `The risk analysis service returned HTTP ${backendResponse.status} (${contentType}).`;
      console.error('Risk-analysis backend returned an error:', {
        url: backendUrl,
        status: backendResponse.status,
        contentType,
        response: responseText.slice(0, 500),
      });
      return NextResponse.json({ error: `${errorMessage}${pathHint}` }, { status: 502 });
    }

    if (!analysisData || typeof analysisData !== 'object' || Array.isArray(analysisData)) {
      return NextResponse.json(
        { error: `The risk analysis service returned an invalid JSON object from ${backendUrl}.` },
        { status: 502 },
      );
    }

    return NextResponse.json(analysisData);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate the risk report.';
    const isConnectionError = error instanceof TypeError && message.toLowerCase().includes('fetch');
    const isConfigurationError = message.includes('RISK_ANALYSIS_API_URL');
    const status = isConfigurationError
      ? 500
      : isConnectionError
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