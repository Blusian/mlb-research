interface PlayerNameButtonProps {
  name: string;
  onClick: () => void;
}

export function PlayerNameButton({ name, onClick }: PlayerNameButtonProps) {
  return (
    <button type="button" className="player-link-button" onClick={onClick}>
      {name}
    </button>
  );
}
