import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import type { EChartsReactProps } from 'echarts-for-react/lib/types'

echarts.use([CanvasRenderer, GridComponent, LineChart, TooltipComponent])

export function EChart(props: EChartsReactProps) {
  return <ReactEChartsCore echarts={echarts} {...props} />
}
