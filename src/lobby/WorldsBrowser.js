export class WorldsBrowser {
  constructor(container, onJoinRoom) {
    this.container = container;
    this.onJoinRoom = onJoinRoom;
    this.worlds = [];
    this.filterText = '';
  }

  updateWorlds(worldsList) {
    this.worlds = worldsList || [];
    this.render();
  }

  setFilter(text) {
    this.filterText = (text || '').toLowerCase().trim();
    this.render();
  }

  render() {
    if (!this.container) return;

    const filtered = this.worlds.filter(w => 
      !this.filterText || w.name.toLowerCase().includes(this.filterText) || (w.owner && w.owner.toLowerCase().includes(this.filterText))
    );

    if (filtered.length === 0) {
      this.container.innerHTML = `
        <div class="worlds-empty">
          <div class="empty-icon"><i class="pixelart-icons-font-globe" style="font-size: 32px;"></i></div>
          <p>No active worlds found matching "${this.filterText || 'any'}"</p>
          <span class="empty-hint">Create a new room above to become the world owner!</span>
        </div>
      `;
      return;
    }

    this.container.innerHTML = filtered.map(world => {
      const isFull = world.playerCount >= 32;
      const timeAgo = this.formatTimeAgo(world.createdAt);

      return `
        <div class="world-card" data-room="${world.name}">
          <div class="world-card-info">
            <div class="world-card-header">
              <span class="world-card-name">${this.escapeHTML(world.name)}</span>
              <span class="world-pill-badge ${world.playerCount > 0 ? 'online' : ''}">
                <i class="pixelart-icons-font-user" style="font-size: 11px; margin-right: 2px;"></i> ${world.playerCount} ${world.playerCount === 1 ? 'Player' : 'Players'}
              </span>
            </div>
            <div class="world-card-meta">
              <span>Owner: <strong>${this.escapeHTML(world.owner || 'Public')}</strong></span>
              <span>&bull;</span>
              <span>${timeAgo}</span>
              ${world.blockCount ? `<span>&bull; ${world.blockCount} blocks</span>` : ''}
            </div>
          </div>
          <button type="button" class="btn-join-world ${isFull ? 'disabled' : ''}" ${isFull ? 'disabled' : ''} data-join="${this.escapeHTML(world.name)}">
            ${isFull ? 'Full' : 'Join <i class="pixelart-icons-font-arrow-right" style="font-size: 14px; margin-left: 4px;"></i>'}
          </button>
        </div>
      `;
    }).join('');

    // Attach click listeners to join buttons
    this.container.querySelectorAll('.btn-join-world').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const roomName = e.currentTarget.getAttribute('data-join');
        if (roomName && this.onJoinRoom) {
          this.onJoinRoom(roomName);
        }
      });
    });
  }

  formatTimeAgo(timestamp) {
    if (!timestamp) return 'Just now';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  }

  escapeHTML(str) {
    return String(str || '').replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }
}
