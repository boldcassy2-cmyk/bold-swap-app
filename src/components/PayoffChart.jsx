import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid
} from 'recharts';
import { calculateBlackScholes } from '../utils/blackScholes';

export default function PayoffChart({
  spotPrice,
  strikePrice,
  optionType = 'call', // 'call' or 'put'
  optionPrice,
  daysToExpiry,
  volatility
}) {
  // Generate 40 data points centered around the strike price
  const data = useMemo(() => {
    if (!spotPrice || spotPrice <= 0 || !strikePrice || strikePrice <= 0) return [];

    const minPrice = Math.max(1, strikePrice * 0.6);
    const maxPrice = strikePrice * 1.4;
    const step = (maxPrice - minPrice) / 40;
    const points = [];

    const timeInYears = Math.max(0.001, daysToExpiry / 365);
    const volDec = Math.max(0.01, volatility / 100);

    for (let S = minPrice; S <= maxPrice; S += step) {
      // 1. Payoff at Expiration (T=0)
      let intrinsicValue = 0;
      if (optionType === 'call') {
        intrinsicValue = Math.max(0, S - strikePrice);
      } else {
        intrinsicValue = Math.max(0, strikePrice - S);
      }
      const pnlAtExpiry = intrinsicValue - optionPrice;

      // 2. Value Today (Black-Scholes curve)
      const bs = calculateBlackScholes({
        S,
        K: strikePrice,
        T: timeInYears,
        r: 0.05,
        v: volDec
      });
      const currentVal = optionType === 'call' ? bs.callPrice : bs.putPrice;
      const pnlToday = currentVal - optionPrice;

      points.push({
        price: Number(S.toFixed(2)),
        pnlExpiry: Number(pnlAtExpiry.toFixed(2)),
        pnlToday: Number(pnlToday.toFixed(2))
      });
    }

    return points;
  }, [spotPrice, strikePrice, optionType, optionPrice, daysToExpiry, volatility]);

  const breakEven = optionType === 'call' 
    ? strikePrice + optionPrice 
    : strikePrice - optionPrice;

  return (
    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
      {/* Header & Metrics */}
      <div className="flex justify-between items-center text-xs font-mono">
        <span className="text-slate-400 font-bold uppercase">
          {optionType} Option Payoff Diagram
        </span>
        <div className="flex gap-4">
          <span className="text-slate-400">
            Break-Even: <strong className="text-cyan-400">${breakEven.toFixed(2)}</strong>
          </span>
          <span className="text-slate-400">
            Max Loss: <strong className="text-rose-400">-${optionPrice.toFixed(2)}</strong>
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis 
              dataKey="price" 
              stroke="#64748b" 
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `$${v}`}
            />
            <YAxis 
              stroke="#64748b" 
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `$${v}`}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace' }}
              labelFormatter={(label) => `Asset Price: $${label}`}
              formatter={(value, name) => [
                `$${value}`,
                name === 'pnlExpiry' ? 'P&L at Expiry' : 'P&L Today (Current Value)'
              ]}
            />
            {/* Zero P&L Line */}
            <ReferenceLine y={0} stroke="#475569" strokeDasharray="2 2" />
            
            {/* Current Spot Price Marker */}
            <ReferenceLine 
              x={Number(spotPrice.toFixed(2))} 
              stroke="#10b981" 
              label={{ value: 'Spot', fill: '#10b981', fontSize: 10, position: 'top' }} 
            />

            {/* Strike Price Marker */}
            <ReferenceLine 
              x={Number(strikePrice.toFixed(2))} 
              stroke="#6366f1" 
              label={{ value: 'Strike', fill: '#6366f1', fontSize: 10, position: 'top' }} 
            />

            {/* Curves */}
            <Line
              type="monotone"
              dataKey="pnlToday"
              stroke="#38bdf8"
              strokeWidth={2}
              dot={false}
              name="pnlToday"
            />
            <Line
              type="monotone"
              dataKey="pnlExpiry"
              stroke={optionType === 'call' ? '#10b981' : '#f43f5e'}
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
              name="pnlExpiry"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-6 text-[10px] font-mono text-slate-400">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-sky-400 inline-block"></span>
          <span>Current Curve (Value Today)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-3 h-0.5 inline-block ${optionType === 'call' ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ borderStyle: 'dashed' }}></span>
          <span>Expiry Curve (Profit / Loss)</span>
        </div>
      </div>
    </div>
  );
}