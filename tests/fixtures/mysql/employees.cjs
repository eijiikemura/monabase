// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Fictional employee rows from the multiline INSERT regression report.
const employees = [
  ['E001', 1, '佐藤 花子', 'hanako.sato@example.com', '部長', '2015-04-01', '650000.00', 'ACTIVE'],
  ['E002', 1, '鈴木 美咲', 'misaki.suzuki@example.com', '人事担当', '2021-10-01', '320000.00', 'ACTIVE'],
  ['E003', 2, '田中 太郎', 'taro.tanaka@example.com', '部長', '2014-06-01', '680000.00', 'ACTIVE'],
  ['E004', 2, '高橋 健', 'ken.takahashi@example.com', '営業担当', '2020-04-01', '350000.00', 'ACTIVE'],
  ['E005', 2, '伊藤 彩', 'aya.ito@example.com', '営業担当', '2023-04-01', '290000.00', 'ACTIVE'],
  ['E006', 3, '山本 大輔', 'daisuke.yamamoto@example.com', '部長', '2013-04-01', '720000.00', 'ACTIVE'],
  ['E007', 3, '中村 翔', 'sho.nakamura@example.com', 'バックエンド開発', '2019-07-01', '460000.00', 'ACTIVE'],
  ['E008', 3, '小林 優子', 'yuko.kobayashi@example.com', 'フロントエンド開発', '2020-10-01', '440000.00', 'ACTIVE'],
  ['E009', 3, '加藤 直樹', 'naoki.kato@example.com', 'DBエンジニア', '2022-04-01', '410000.00', 'ACTIVE'],
  ['E010', 3, '吉田 葵', 'aoi.yoshida@example.com', 'QAエンジニア', '2024-04-01', '300000.00', 'LEAVE'],
  ['E011', 4, '渡辺 恵', 'megumi.watanabe@example.com', '部長', '2016-04-01', '610000.00', 'ACTIVE'],
  ['E012', 4, '松本 誠', 'makoto.matsumoto@example.com', '経理担当', '2022-10-01', '330000.00', 'ACTIVE'],
  ['E013', 5, '井上 亮', 'ryo.inoue@example.com', 'チームリーダー', '2018-05-01', '480000.00', 'ACTIVE'],
  ['E014', 5, '木村 梨花', 'rika.kimura@example.com', 'サポート担当', '2023-07-01', '280000.00', 'ACTIVE'],
  ['E015', 5, '林 拓海', 'takumi.hayashi@example.com', 'サポート担当', '2021-04-01', '310000.00', 'RETIRED'],
];
function employeeInsert(table) {
  const literal = value => typeof value === 'number' ? String(value) : "'" + value.replaceAll("'", "''") + "'";
  return `INSERT INTO ${table}\n    (employee_code, department_id, employee_name, email, job_title, hire_date, salary, employment_status)\nVALUES\n` + employees.map(row => '    (' + row.map(literal).join(', ') + ')').join(',\n') + ';';
}
module.exports = { employees, employeeInsert };
