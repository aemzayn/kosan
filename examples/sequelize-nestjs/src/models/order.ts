import type { AdapterContext } from '@huni/sequelize';
import { DataTypes } from 'sequelize';

export function OrderModel({ sequelize }: AdapterContext) {
  return sequelize.define(
    'Order',
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      product: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      total: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
    },
    { tableName: 'orders', underscored: true },
  );
}
