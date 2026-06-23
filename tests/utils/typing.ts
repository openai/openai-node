type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

export const expectType = <T>(_expression: T): void => {
  return;
};

export const compareType = <T1, T2>(_expression: Equal<T1, T2>): void => {
  return;
};
