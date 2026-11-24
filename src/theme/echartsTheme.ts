import * as echarts from 'echarts';
import { BRAND_TOKENS, CHART_SERIES_ORDER } from './tokens';

let themeRegistered = false;

export function createLeaveDecal() {
  return {
    symbol: 'rect' as const,
    dashArrayX: [1, 0],
    dashArrayY: [3, 3],
    rotation: -Math.PI / 4,
    color: BRAND_TOKENS.cream,
  };
}

export function registerHayEChartsTheme(): void {
  if (themeRegistered) return;
  themeRegistered = true;

  echarts.registerTheme('hay-workforce', {
    color: [...CHART_SERIES_ORDER],
    backgroundColor: 'transparent',
    textStyle: {
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: 12,
      color: BRAND_TOKENS.brown,
    },
    title: {
      show: false,
    },
    legend: {
      textStyle: {
        color: BRAND_TOKENS.brown,
        fontSize: 12,
      },
      icon: 'roundRect',
      itemWidth: 12,
      itemHeight: 8,
      itemGap: 14,
    },
    tooltip: {
      backgroundColor: BRAND_TOKENS.surface,
      borderColor: BRAND_TOKENS.border,
      borderWidth: 1,
      textStyle: {
        color: BRAND_TOKENS.brown,
        fontSize: 12,
      },
      extraCssText: 'box-shadow: none; border-radius: 8px;',
    },
    categoryAxis: {
      axisLine: {
        show: true,
        lineStyle: { color: BRAND_TOKENS.border },
      },
      axisTick: { show: false },
      axisLabel: {
        color: BRAND_TOKENS.brown,
        fontSize: 12,
      },
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: BRAND_TOKENS.muted,
        fontSize: 11,
      },
      splitLine: {
        show: false,
      },
    },
    bar: {
      itemStyle: {
        borderRadius: [3, 3, 0, 0],
      },
    },
  });
}

export const HORIZONTAL_GUIDE_SPLITLINE = {
  show: true,
  lineStyle: {
    color: BRAND_TOKENS.guide,
    width: 1,
  },
};
