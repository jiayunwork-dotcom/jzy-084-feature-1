import { pool } from './pool.js';

/**
 * Seed a small, instantly-usable demo (Address + User models and two
 * interfaces) only when the project has no definitions yet.
 */
export async function seedDemoData(projectId) {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM models WHERE project_id = $1) AS model_count,
            (SELECT count(*) FROM interfaces WHERE project_id = $1) AS interface_count`,
    [projectId],
  );
  if (Number(rows[0].model_count) > 0 || Number(rows[0].interface_count) > 0) {
    return;
  }

  const addressFields = [
    { id: 'a1', name: 'province', type: 'string' },
    { id: 'a2', name: 'detail', type: 'string' },
    { id: 'a3', name: 'zipCode', type: 'string' },
  ];
  const { rows: addressRows } = await pool.query(
    `INSERT INTO models (project_id, name, fields) VALUES ($1, 'Address', $2) RETURNING id`,
    [projectId, JSON.stringify(addressFields)],
  );
  const addressId = addressRows[0].id;

  const { rows: companyRows } = await pool.query(
    `INSERT INTO models (project_id, name, fields) VALUES ($1, 'Company', $2) RETURNING id`,
    [
      projectId,
      JSON.stringify([
        { id: 'co1', name: 'companyName', type: 'string' },
        { id: 'co2', name: 'website', type: 'string' },
        { id: 'co3', name: 'address', type: 'ref', ref: addressId },
      ]),
    ],
  );
  const companyId = companyRows[0].id;

  const userFields = [
    { id: 'u1', name: 'id', type: 'number', min: 1000, max: 9999 },
    { id: 'u2', name: 'userName', type: 'string' },
    { id: 'u3', name: 'email', type: 'string' },
    { id: 'u4', name: 'phone', type: 'string' },
    { id: 'u5', name: 'avatar', type: 'string' },
    { id: 'u6', name: 'isVip', type: 'boolean' },
    // 多层模型引用：User -> Company -> Address
    { id: 'u7', name: 'employer', type: 'ref', ref: companyId },
    { id: 'u8', name: 'tags', type: 'array', items: { id: 'u8i', name: 'tag', type: 'string' } },
  ];
  const { rows: userRows } = await pool.query(
    `INSERT INTO models (project_id, name, fields) VALUES ($1, 'User', $2) RETURNING id`,
    [projectId, JSON.stringify(userFields)],
  );
  const userId = userRows[0].id;

  const listResponse = {
    fields: [
      { id: 'l1', name: 'code', type: 'number', min: 0, max: 0 },
      { id: 'l2', name: 'message', type: 'string' },
      {
        id: 'l3',
        name: 'data',
        type: 'array',
        items: { id: 'l3i', name: 'user', type: 'ref', ref: userId },
      },
    ],
  };

  const vipResponse = {
    fields: [
      { id: 'v1', name: 'code', type: 'number', min: 0, max: 0 },
      {
        id: 'v2',
        name: 'data',
        type: 'object',
        fields: [
          ...userFields,
          { id: 'v21', name: 'level', type: 'enum', values: ['gold', 'platinum', 'diamond'] },
          { id: 'v22', name: 'homePage', type: 'string' },
        ],
      },
    ],
  };

  await pool.query(
    `INSERT INTO interfaces (project_id, name, path, method, default_response, scenarios)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      projectId,
      '用户列表',
      '/api/users',
      'GET',
      JSON.stringify(listResponse),
      JSON.stringify([
        {
          id: 'sc-vip',
          name: 'VIP 用户查询',
          statusCode: 200,
          conditions: [
            { id: 'c1', location: 'query', field: 'vip', operator: 'eq', value: 'true' },
          ],
          response: vipResponse,
        },
      ]),
    ],
  );

  await pool.query(
    `INSERT INTO interfaces (project_id, name, path, method, default_response, scenarios)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      projectId,
      '用户详情',
      '/api/users/:id',
      'GET',
      JSON.stringify({
        fields: [
          { id: 'd1', name: 'code', type: 'number', min: 0, max: 0 },
          { id: 'd2', name: 'data', type: 'ref', ref: userId },
        ],
      }),
      JSON.stringify([]),
    ],
  );
}
