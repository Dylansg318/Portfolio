import { parseAddress } from '../parseAddress';

describe('parseAddress', () => {
  test('comma-less single line splits street / city / state / zip (the paste-screenshot case)', () => {
    const r = parseAddress('123 oak st springfield IL 62704');
    expect(r.addr1).toBe('123 oak st');
    expect(r.city).toBe('Springfield');
    expect(r.state).toBe('IL');
    expect(r.zip).toBe('62704');
  });

  test('comma-delimited address with a leading recipient name', () => {
    const r = parseAddress('John Smith, 123 Main St, Springfield, IL 62701');
    expect(r.name).toBe('John Smith');
    expect(r.addr1).toBe('123 Main St');
    expect(r.city).toBe('Springfield');
    expect(r.state).toBe('IL');
    expect(r.zip).toBe('62701');
  });

  test('comma-less multi-word street resolves on the last street-suffix token', () => {
    const r = parseAddress('123 Martin Luther King Jr Blvd Chicago IL 60616');
    expect(r.addr1).toBe('123 Martin Luther King Jr Blvd');
    expect(r.city).toBe('Chicago');
    expect(r.state).toBe('IL');
    expect(r.zip).toBe('60616');
  });

  test('comma-less secondary unit lands in addr2, not the city', () => {
    const r = parseAddress('500 W Madison St Ste 1000 Chicago IL 60661');
    expect(r.addr1).toBe('500 W Madison St');
    expect(r.addr2).toBe('Ste 1000');
    expect(r.city).toBe('Chicago');
    expect(r.state).toBe('IL');
    expect(r.zip).toBe('60661');
  });

  test('comma-less with a full state name', () => {
    const r = parseAddress('742 Evergreen Terrace Springfield Illinois 62704');
    expect(r.addr1).toBe('742 Evergreen Terrace');
    expect(r.city).toBe('Springfield');
    expect(r.state).toBe('IL');
    expect(r.zip).toBe('62704');
  });

  test('comma-less PO Box', () => {
    const r = parseAddress('PO Box 123 Chicago IL 60601');
    expect(r.addr1).toBe('PO Box 123');
    expect(r.city).toBe('Chicago');
    expect(r.state).toBe('IL');
    expect(r.zip).toBe('60601');
  });

  test('newline-separated block keeps the name line (newlines act as commas)', () => {
    const r = parseAddress('Acme Labs\n500 W Madison St\nChicago IL 60661');
    expect(r.name).toBe('Acme Labs');
    expect(r.addr1).toBe('500 W Madison St');
    expect(r.city).toBe('Chicago');
    expect(r.state).toBe('IL');
    expect(r.zip).toBe('60661');
  });

  test('no street suffix and no comma keeps the raw text in addr1 — never guesses a city', () => {
    const r = parseAddress('Acme Warehouse IL 60527');
    expect(r.addr1).toBe('Acme Warehouse');
    expect(r.city).toBe('');
    expect(r.state).toBe('IL');
    expect(r.zip).toBe('60527');
  });
});
