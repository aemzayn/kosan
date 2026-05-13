import { DataTypes } from 'sequelize';
import type { AdapterContext } from '@kosan/sequelize';

export function UserModel({ sequelize }: AdapterContext) {
  return sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
      },
    },
    { tableName: 'users', underscored: true },
  );
}
