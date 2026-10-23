import { NextResponse } from "next/server";

// Genuinely live spot price + intraday series via Yahoo's chart endpoint,
// which (unlike the options-chain endpoint) doesn't require a rotating
// crumb token -- safe to call live, on every page load, during a demo.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker") ?? "SPY";

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=5m&range=1d`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
        cache: "no-store",
      }
    );
    if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) throw new Error("Unexpected response shape");

    const timestamps: number[] = result.timestamp ?? [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const series = timestamps
      .map((t, i) => ({ t, price: closes[i] }))
      .filter((p): p is { t: number; price: number } => typeof p.price === "number");

    return NextResponse.json({
      ticker,
      price: meta.regularMarketPrice,
      changePercent: meta.regularMarketChangePercent,
      dayHigh: meta.regularMarketDayHigh,
      dayLow: meta.regularMarketDayLow,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
      volume: meta.regularMarketVolume,
      previousClose: meta.previousClose ?? meta.chartPreviousClose,
      time: meta.regularMarketTime,
      series,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Live spot price fetch failed", detail: String(err) },
      { status: 502 }
    );
  }
}
