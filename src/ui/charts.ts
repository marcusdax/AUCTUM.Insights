import * as echarts from 'echarts';
import type {
  DOEResult,
  MonteCarloResult,
  ShapleyAttribution,
  UnderwritingMetrics,
} from '../engine/types';

export class ChartManager {
  private charts = new Map<string, echarts.ECharts>();

  private getOrInit(id: string): echarts.ECharts | null {
    const el = document.getElementById(id);
    if (!el) return null;
    let inst = this.charts.get(id);
    if (!inst) {
      inst = echarts.init(el);
      this.charts.set(id, inst);
    }
    return inst;
  }

  resizeAll(): void {
    this.charts.forEach((c) => c.resize());
  }

  renderUnderwritingSuite(m: UnderwritingMetrics): void {
    // 1. 10-Year Wealth Velocity
    const c1 = this.getOrInit('echart-10yr');
    if (c1) {
      c1.setOption({
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'axis',
          backgroundColor: '#1f2230',
          borderColor: '#3a3f54',
          textStyle: { color: '#f3f2ee', fontSize: 12 },
        },
        legend: { top: 0, textStyle: { color: '#b4b8cc', fontSize: 11 } },
        grid: { left: 56, right: 18, top: 36, bottom: 26 },
        xAxis: {
          type: 'category',
          data: m.years,
          axisLine: { lineStyle: { color: '#3a3f54' } },
          axisLabel: { color: '#9ca1b8', fontSize: 11 },
        },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
          axisLabel: {
            color: '#9ca1b8',
            fontSize: 11,
            formatter: (v: number) => `$${Math.round(v / 1000)}k`,
          },
        },
        series: [
          {
            name: 'Total Equity',
            type: 'line',
            smooth: true,
            data: m.equitySeries,
            lineStyle: { width: 2.5, color: '#9ba8ff' },
            itemStyle: { color: '#9ba8ff' },
            areaStyle: { color: 'rgba(155,168,255,0.16)' },
          },
          {
            name: 'Cumulative Cash Flow',
            type: 'line',
            smooth: true,
            data: m.cfSeries,
            lineStyle: { width: 2.5, color: '#6fd4aa' },
            itemStyle: { color: '#6fd4aa' },
            areaStyle: { color: 'rgba(111,212,170,0.12)' },
          },
          {
            name: 'Remaining Debt',
            type: 'line',
            smooth: true,
            data: m.debtSeries,
            lineStyle: { width: 2, type: 'dashed', color: '#e5b887' },
            itemStyle: { color: '#e5b887' },
          },
        ],
      });
    }

    // 2. Monthly Cash-Flow Bridge
    const c2 = this.getOrInit('echart-waterfall');
    if (c2) {
      c2.setOption({
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'axis',
          backgroundColor: '#1f2230',
          borderColor: '#3a3f54',
          textStyle: { color: '#f3f2ee', fontSize: 12 },
        },
        grid: { left: 52, right: 12, top: 18, bottom: 28 },
        xAxis: {
          type: 'category',
          data: ['Gross', 'Vac', 'OpEx', 'NOI', 'Debt', 'Net'],
          axisLine: { lineStyle: { color: '#3a3f54' } },
          axisLabel: { color: '#9ca1b8', fontSize: 10 },
        },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
          axisLabel: { color: '#9ca1b8', fontSize: 10, formatter: (v: number) => `$${Math.round(v)}` },
        },
        series: [
          {
            type: 'bar',
            barWidth: '54%',
            data: [
              { value: Math.round(m.grossMo), itemStyle: { color: '#9ba8ff' } },
              { value: -Math.round(m.vacancyMo), itemStyle: { color: '#d87da0' } },
              { value: -Math.round(m.opexMo), itemStyle: { color: '#e5b887' } },
              { value: Math.round(m.noiMo), itemStyle: { color: '#7ea2f8' } },
              { value: -Math.round(m.mDebt), itemStyle: { color: '#d87da0' } },
              {
                value: Math.round(m.mCf),
                itemStyle: { color: m.mCf >= 0 ? '#6fd4aa' : '#d87da0' },
              },
            ],
            itemStyle: { borderRadius: [5, 5, 0, 0] },
          },
        ],
      });
    }

    // 3. 30-Night Occupancy & Settlement Cadence
    const c3 = this.getOrInit('echart-nights');
    if (c3) {
      const breakEvenNights = Math.min(30, Math.max(1, Math.round((m.breakEvenOccPct / 100) * 30)));
      const occupiedNights = Math.round((1 - m.vacancyPct) * 30);
      const cushionNights = Math.max(0, occupiedNights - breakEvenNights);
      const vacantNights = Math.max(0, 30 - occupiedNights);

      c3.setOption({
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'item',
          backgroundColor: '#1f2230',
          borderColor: '#3a3f54',
          textStyle: { color: '#f3f2ee', fontSize: 12 },
        },
        legend: { bottom: 0, textStyle: { color: '#b4b8cc', fontSize: 10 } },
        series: [
          {
            type: 'pie',
            radius: ['50%', '74%'],
            center: ['50%', '44%'],
            label: { show: false },
            data: [
              { value: breakEvenNights, name: `Break-Even (${breakEvenNights}d)`, itemStyle: { color: '#e5b887' } },
              { value: cushionNights, name: `Profit Cushion (${cushionNights}d)`, itemStyle: { color: '#6fd4aa' } },
              { value: vacantNights, name: `Vacancy Buffer (${vacantNights}d)`, itemStyle: { color: '#58607e' } },
            ],
          },
        ],
      });
    }
  }

  renderDecisionsSuite(
    m: UnderwritingMetrics,
    doe: DOEResult,
    mc: MonteCarloResult,
    locationScore: number,
    roofAgeYears: number
  ): void {
    // 4. 6-Factor Radar
    const cRadar = this.getOrInit('echart-radar');
    if (cRadar) {
      const scores = [
        Math.min(100, Math.round(m.capRate * 12)),
        Math.min(100, Math.round(m.dscr * 65)),
        Math.min(100, Math.round(locationScore)),
        Math.min(100, Math.max(25, Math.round(100 - roofAgeYears * 2.5))),
        Math.min(100, Math.round((doe.passCount / 8) * 100)),
        Math.min(100, Math.round(100 - Math.min(100, m.breakEvenOccPct) * 0.7)),
      ];
      cRadar.setOption({
        backgroundColor: 'transparent',
        radar: {
          indicator: [
            { name: 'Yield', max: 100 },
            { name: 'DSCR', max: 100 },
            { name: 'Spatial', max: 100 },
            { name: 'Envelope', max: 100 },
            { name: 'DOE', max: 100 },
            { name: 'Cushion', max: 100 },
          ],
          axisName: { color: '#b4b8cc', fontSize: 11 },
          splitArea: { areaStyle: { color: ['rgba(155,168,255,0.03)', 'rgba(155,168,255,0.06)'] } },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.10)' } },
        },
        series: [
          {
            type: 'radar',
            data: [
              {
                value: scores,
                name: 'Deal Scorecard',
                lineStyle: { color: '#9ba8ff', width: 2 },
                itemStyle: { color: '#9ba8ff' },
                areaStyle: { color: 'rgba(155,168,255,0.24)' },
              },
            ],
          },
        ],
      });
    }

    // 5. 2^3 DOE Main & 2-Way Interaction Effects Pareto Chart
    const cDoe = this.getOrInit('echart-doe');
    if (cDoe) {
      const sorted = [...doe.effects].sort((a, b) => Math.abs(b.dscrEffect) - Math.abs(a.dscrEffect));
      cDoe.setOption({
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'axis',
          backgroundColor: '#1f2230',
          borderColor: '#3a3f54',
          textStyle: { color: '#f3f2ee', fontSize: 12 },
        },
        grid: { left: 138, right: 20, top: 14, bottom: 26 },
        xAxis: {
          type: 'value',
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
          axisLabel: { color: '#9ca1b8', fontSize: 10, formatter: (v: number) => `${v > 0 ? '+' : ''}${v}x` },
        },
        yAxis: {
          type: 'category',
          data: sorted.map((e) => e.label).reverse(),
          axisLine: { lineStyle: { color: '#3a3f54' } },
          axisLabel: { color: '#d0d3e2', fontSize: 10 },
        },
        series: [
          {
            name: 'DSCR Effect',
            type: 'bar',
            barWidth: '55%',
            data: sorted
              .map((e) => ({
                value: e.dscrEffect,
                itemStyle: {
                  color: e.kind === 'interaction' ? '#e5b887' : e.dscrEffect < 0 ? '#d87da0' : '#6fd4aa',
                },
              }))
              .reverse(),
          },
        ],
      });
    }

    // 6. 1,000-Trial Monte Carlo DSCR Histogram
    const cMc = this.getOrInit('echart-montecarlo');
    if (cMc) {
      cMc.setOption({
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'axis',
          backgroundColor: '#1f2230',
          borderColor: '#3a3f54',
          textStyle: { color: '#f3f2ee', fontSize: 12 },
        },
        grid: { left: 42, right: 16, top: 18, bottom: 28 },
        xAxis: {
          type: 'category',
          data: mc.histogramBins.map((b) => b.label),
          axisLine: { lineStyle: { color: '#3a3f54' } },
          axisLabel: { color: '#9ca1b8', fontSize: 10 },
        },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
          axisLabel: { color: '#9ca1b8', fontSize: 10 },
        },
        series: [
          {
            name: 'Trials',
            type: 'bar',
            barWidth: '72%',
            data: mc.histogramBins.map((b) => ({
              value: b.count,
              itemStyle: {
                color: b.min >= 1.2 ? '#6fd4aa' : b.max >= 1.05 ? '#e5b887' : '#d87da0',
                borderRadius: [4, 4, 0, 0],
              },
            })),
          },
        ],
      });
    }
  }

  renderShapleyChart(attr: ShapleyAttribution): void {
    const c = this.getOrInit('echart-masternex');
    if (!c) return;
    c.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1f2230',
        borderColor: '#3a3f54',
        textStyle: { color: '#f3f2ee', fontSize: 12 },
      },
      grid: { left: 60, right: 20, top: 20, bottom: 30 },
      xAxis: {
        type: 'category',
        data: ['NADE (Anomaly/DOE)', 'GIE (Spatial Hex)', 'BNE (Demand/Yield)'],
        axisLine: { lineStyle: { color: '#3a3f54' } },
        axisLabel: { color: '#c8ccdc', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        max: 10000,
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        axisLabel: { color: '#9ca1b8', fontSize: 10, formatter: (v: number) => `${v} bps` },
      },
      series: [
        {
          name: 'Shapley Attribution (bps)',
          type: 'bar',
          barWidth: '48%',
          data: [
            { value: attr.nadeBps, itemStyle: { color: '#d87da0', borderRadius: [6, 6, 0, 0] } },
            { value: attr.gieBps, itemStyle: { color: '#9ba8ff', borderRadius: [6, 6, 0, 0] } },
            { value: attr.bneBps, itemStyle: { color: '#6fd4aa', borderRadius: [6, 6, 0, 0] } },
          ],
          label: {
            show: true,
            position: 'top',
            color: '#f3f2ee',
            fontSize: 11,
            formatter: '{c} bps',
          },
        },
      ],
    });
  }

  renderSensitivityHeatmap(grid: {
    priceSteps: number[];
    rateSteps: number[];
    cells: [number, number, number][];
  }): void {
    const c = this.getOrInit('echart-heatmap');
    if (!c) return;
    c.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        position: 'top',
        backgroundColor: '#1f2230',
        borderColor: '#3a3f54',
        textStyle: { color: '#f3f2ee', fontSize: 12 },
        formatter: (params: { value: [number, number, number] }) => {
          const [pi, ri, dscr] = params.value;
          return `Price: <strong>$${grid.priceSteps[pi].toLocaleString()}</strong><br/>Rate: <strong>${grid.rateSteps[ri].toFixed(
            2
          )}%</strong><br/>DSCR: <strong>${dscr.toFixed(2)}x</strong>`;
        },
      },
      grid: { left: 60, right: 16, top: 14, bottom: 34 },
      xAxis: {
        type: 'category',
        data: grid.priceSteps.map((v) => `$${Math.round(v / 1000)}k`),
        axisLabel: { color: '#b4b8cc', fontSize: 10 },
        axisLine: { lineStyle: { color: '#3a3f54' } },
      },
      yAxis: {
        type: 'category',
        data: grid.rateSteps.map((r) => `${r.toFixed(2)}%`),
        axisLabel: { color: '#b4b8cc', fontSize: 10 },
        axisLine: { lineStyle: { color: '#3a3f54' } },
      },
      visualMap: {
        min: 0.9,
        max: 1.5,
        show: false,
        inRange: { color: ['#a8466a', '#c98e5b', '#4eb88e'] },
      },
      series: [
        {
          name: 'DSCR',
          type: 'heatmap',
          data: grid.cells,
          label: {
            show: true,
            color: '#141722',
            fontWeight: 600,
            fontSize: 11,
            formatter: (p: { value: [number, number, number] }) => `${p.value[2].toFixed(2)}x`,
          },
          itemStyle: { borderColor: '#1d202d', borderWidth: 2, borderRadius: 4 },
        },
      ],
    });
  }
}
