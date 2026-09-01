import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useEscapeBack } from '../useEscapeBack';

function Detail({ fallback = '/orders' }) {
  useEscapeBack(fallback);
  return <div>detail</div>;
}
function WhereAmI() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}
function renderAt(entries) {
  return render(
    <MemoryRouter initialEntries={entries}>
      <WhereAmI />
      <Routes>
        <Route path="/orders" element={<div>list</div>} />
        <Route path="/orders/:id" element={<Detail />} />
        <Route path="/somewhere" element={<div>custom</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('useEscapeBack', () => {
  test('Escape navigates to the fallback list route', () => {
    const { getByTestId } = renderAt(['/orders/123']);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(getByTestId('loc')).toHaveTextContent('/orders');
  });

  test('prefers location.state.from over the fallback', () => {
    const { getByTestId } = renderAt([{ pathname: '/orders/123', state: { from: '/somewhere' } }]);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(getByTestId('loc')).toHaveTextContent('/somewhere');
  });

  test('does nothing while a modal is open', () => {
    const { getByTestId } = renderAt(['/orders/123']);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(getByTestId('loc')).toHaveTextContent('/orders/123');
    overlay.remove();
  });

  test('does nothing while typing in an input', () => {
    const { getByTestId, container } = renderAt(['/orders/123']);
    const input = document.createElement('input');
    container.appendChild(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(getByTestId('loc')).toHaveTextContent('/orders/123');
  });

  // Pins the mechanism inline-edit forms rely on: an in-page edit surface
  // (not a modal) that consumes Escape itself — onKeyDown + preventDefault —
  // must stop this hook from navigating away mid-edit. isTypingContext()
  // treats e.defaultPrevented as "already handled" and stays quiet.
  test('an inline-edit container that preventDefaults Escape blocks navigation', () => {
    function EditGuard({ children }) {
      return (
        <div onKeyDown={(e) => { if (e.key === 'Escape') e.preventDefault(); }}>
          {children}
        </div>
      );
    }
    const { getByTestId, getByRole } = render(
      <MemoryRouter initialEntries={['/orders/123']}>
        <WhereAmI />
        <Routes>
          <Route path="/orders" element={<div>list</div>} />
          <Route
            path="/orders/:id"
            element={(
              <>
                <Detail />
                <EditGuard>
                  <button type="button">field</button>
                </EditGuard>
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.keyDown(getByRole('button', { name: 'field' }), { key: 'Escape' });
    expect(getByTestId('loc')).toHaveTextContent('/orders/123');
  });

  // Companion negative case: without preventDefault, the same composition
  // lets the event reach the document-level handler and the hook navigates —
  // proving the guard above is actually load-bearing, not an accident.
  test('without preventDefault, Escape from the same composition still navigates', () => {
    function NoGuard({ children }) {
      return <div>{children}</div>;
    }
    const { getByTestId, getByRole } = render(
      <MemoryRouter initialEntries={['/orders/123']}>
        <WhereAmI />
        <Routes>
          <Route path="/orders" element={<div>list</div>} />
          <Route
            path="/orders/:id"
            element={(
              <>
                <Detail />
                <NoGuard>
                  <button type="button">field</button>
                </NoGuard>
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.keyDown(getByRole('button', { name: 'field' }), { key: 'Escape' });
    expect(getByTestId('loc')).toHaveTextContent('/orders');
  });
});
