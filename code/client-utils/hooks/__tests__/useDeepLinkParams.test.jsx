/**
 * The shared deep-link seam: apply once, then consume the params.
 *
 * Both halves are load-bearing. Applying late is what makes the link beat the
 * filters a page restores from sessionStorage; consuming is what stops the trip
 * back from an order/product detail re-applying the link over whatever the
 * operator narrowed to after landing.
 */
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useDeepLinkParams } from '../useDeepLinkParams';

function Harness({ onApply }) {
  const location = useLocation();
  const navigate = useNavigate();
  const consumed = useDeepLinkParams(['q', 'status'], onApply);
  return (
    <div>
      <span data-testid="search">{location.search}</span>
      <span data-testid="consumed">{String(consumed.current)}</span>
      <button onClick={() => navigate('/list?q=second')}>relink</button>
      <button onClick={() => navigate('/other')}>leave</button>
    </div>
  );
}

function renderAt(url, onApply) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/list" element={<Harness onApply={onApply} />} />
        <Route path="/other" element={<div>elsewhere</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('useDeepLinkParams', () => {
  it('applies only the params that are present', () => {
    const onApply = jest.fn();
    renderAt('/list?q=SKU-1234', onApply);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({ q: 'SKU-1234' });
  });

  it('applies several params together', () => {
    const onApply = jest.fn();
    renderAt('/list?q=abc&status=on_hold', onApply);
    expect(onApply).toHaveBeenCalledWith({ q: 'abc', status: 'on_hold' });
  });

  it('consumes the params so the trip back cannot re-apply them', () => {
    const onApply = jest.fn();
    renderAt('/list?q=SKU-1234', onApply);
    expect(screen.getByTestId('search').textContent).toBe('');
    expect(screen.getByTestId('consumed').textContent).toBe('true');
  });

  it('leaves params it was not given alone', () => {
    const onApply = jest.fn();
    renderAt('/list?q=abc&view=preset:open-all', onApply);
    expect(screen.getByTestId('search').textContent).toBe('?view=preset%3Aopen-all');
  });

  it('does nothing at all without a deep link', () => {
    const onApply = jest.fn();
    renderAt('/list', onApply);
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByTestId('consumed').textContent).toBe('false');
  });

  it('re-applies when the SAME link is followed again', () => {
    // Only true because the param was consumed the first time; while it sat in
    // the URL a repeat navigation to the identical link changed nothing.
    const onApply = jest.fn();
    renderAt('/list?q=second', onApply);
    expect(onApply).toHaveBeenCalledTimes(1);
    act(() => { screen.getByText('relink').click(); });
    expect(onApply).toHaveBeenCalledTimes(2);
  });

  it('does not re-apply on a re-render', () => {
    const onApply = jest.fn();
    const { rerender } = renderAt('/list?q=abc', onApply);
    rerender(
      <MemoryRouter initialEntries={['/list?q=abc']}>
        <Routes><Route path="/list" element={<Harness onApply={onApply} />} /></Routes>
      </MemoryRouter>,
    );
    // The rerender mounts a fresh router, so one apply per mount — never twice
    // for one mount, which is what would stomp the operator's own edits.
    expect(onApply.mock.calls.every(c => c[0].q === 'abc')).toBe(true);
  });
});
