import { DataTypes, type Model, type ModelStatic, type Sequelize } from "sequelize";

export function OrderModel(sequelize: Sequelize): ModelStatic<Model> {
  return sequelize.define(
    "Order",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      product: { type: DataTypes.STRING(200), allowNull: false },
      total: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    },
    { tableName: "orders", underscored: true },
  );
}
