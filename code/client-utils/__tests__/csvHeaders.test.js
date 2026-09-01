import { parseCSVHeaders, parseFileColumns } from '../csv';

describe('client CSV header helpers', () => {
  test('parseCSVHeaders reads only the header row', () => {
    const text = 'Order#,"Vendor, Amount",Transaction Date\n"unterminated';

    expect(parseCSVHeaders(text)).toEqual([
      'Order#',
      'Vendor, Amount',
      'Transaction Date',
    ]);
  });

  test('parseFileColumns reads CSV file headers without parsing data rows', async () => {
    const file = new File(
      ['Order#,Vendor Amount,Transaction Date\n"unterminated'],
      'sample.csv',
      { type: 'text/csv' }
    );

    await expect(parseFileColumns(file)).resolves.toEqual([
      'Order#',
      'Vendor Amount',
      'Transaction Date',
    ]);
  });
});
