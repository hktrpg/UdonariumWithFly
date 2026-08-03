import { GridType } from '@udonarium/game-table';
import { fillHexCell, isHexGrid, strokeHexCell } from '@udonarium/hex-grid';

type StrokeGridFunc = (w: number, h: number, gridSize: number) => GridPosition;
type GridPosition = { gx: number, gy: number };

export class GridLineRender {
  constructor(readonly canvasElement: HTMLCanvasElement) {
  }

  private makeBrush(context: CanvasRenderingContext2D, gridSize: number, gridColor: string): CanvasRenderingContext2D {
    context.strokeStyle = gridColor;
    context.fillStyle = context.strokeStyle;
    context.lineWidth = 1;

    let fontSize: number = Math.floor(gridSize / 5);
    context.font = `bold ${fontSize}px sans-serif`;
    context.textBaseline = 'middle';
    context.textAlign = 'center';
    return context
  }

  render(width: number, height: number, gridSize: number = 50, gridType: GridType = GridType.SQUARE, gridColor: string = '#000000e6', isShowNumber = true) {
    this.canvasElement.width = width * gridSize;
    this.canvasElement.height = height * gridSize;
    let context: CanvasRenderingContext2D = this.canvasElement.getContext('2d');

    if (gridType < 0) return;

    const hex = isHexGrid(gridType);
    let calcGridPosition: StrokeGridFunc = this.generateCalcGridPositionFunc(gridType);
    this.makeBrush(context, gridSize, gridColor);
    // Square draws an extra rim cell so outer edges appear; hex only needs real cells.
    const wMax = hex ? width : width + 1;
    const hMax = hex ? height : height + 1;
    for (let h = 0; h < hMax; h++) {
      for (let w = 0; w < wMax; w++) {
        let { gx, gy } = calcGridPosition(w, h, gridSize);
        if (hex) {
          strokeHexCell(context, gx, gy, gridSize, gridType);
        } else {
          this.strokeSquare(context, gx, gy, gridSize);
        }
        if (isShowNumber && w < width && h < height) {
          context.fillText(
            (w + 1).toString() + '-' + (h + 1).toString(),
            gx + (gridSize / 2),
            gy + (gridSize / 2),
          );
        }
      }
    }
  }

  private generateCalcGridPositionFunc(gridType: GridType): StrokeGridFunc {
    switch (gridType) {
      case GridType.HEX_VERTICAL: // pointy-top, odd-q style (even columns shifted down)
        return (w, h, gridSize) => {
          if ((w % 2) === 1) {
            return { gx: w * gridSize, gy: h * gridSize };
          } else {
            return { gx: w * gridSize, gy: h * gridSize + (gridSize / 2) };
          }
        }

      case GridType.HEX_HORIZONTAL: // flat-top (DodontoF compatible)
        return (w, h, gridSize) => {
          if ((h % 2) === 1) {
            return { gx: w * gridSize, gy: h * gridSize };
          } else {
            return { gx: w * gridSize + (gridSize / 2), gy: h * gridSize };
          }
        }

      default:
        return (w, h, gridSize) => {
          return { gx: w * gridSize, gy: h * gridSize };
        }
    }
  }

  private strokeSquare(context: CanvasRenderingContext2D, gx: number, gy: number, gridSize: number) {
    context.beginPath();
    context.strokeRect(gx, gy, gridSize, gridSize);
  }
}
