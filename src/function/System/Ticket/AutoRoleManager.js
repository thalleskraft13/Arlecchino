'use strict';

/**
 * AutoRoleManager
 *
 * Responsável por:
 *  - Aplicar cargos automáticos ao abrir tickets
 *  - Remover cargos temporários (baseado em persistência + verificação periódica)
 *  - Remover cargos vinculados ao fechar tickets (respeitando outros tickets ativos)
 *  - Validar hierarquia e permissões antes de qualquer operação
 */

const mongoose       = require('mongoose');
const DiscordRequest = require('../../DiscordRequest.js');
const { PendingTempRoleModel, ActiveLinkedRoleModel } = require('../../../Mongodb/guild.js');

const SWEEP_INTERVAL_MS = 60_000; // verifica temporários a cada 1 min

class AutoRoleManager {

  constructor(client) {
    this.client = client;
    this._botRolePosition = new Map(); // guildId → { position, expires }
    this._startTempRoleSweep();
  }

  /* ═══════════════════════════════════════════
     APLICAR CARGOS AO ABRIR TICKET
     ═══════════════════════════════════════════ */

  /**
   * Aplica todos os cargos automáticos configurados no painel.
   *
   * @param {{ guildId: string, userId: string, ticketId: string, panel: object }} opts
   */
  async applyRoles({ guildId, userId, ticketId, panel }) {
    const cfg = panel.autoRoleConfig;
    if (!cfg?.enabled || !cfg.roles?.length) return;

    const botMaxPos = await this._getBotHighestRolePosition(guildId);

    for (const entry of cfg.roles) {
      try {
        const canAssign = await this._canAssignRole(guildId, entry.roleId, botMaxPos);
        if (!canAssign) {
          console.warn(`[AutoRole] Cargo ${entry.roleId} está acima do bot — ignorado`);
          continue;
        }

        await this._addRole(guildId, userId, entry.roleId);

        if (entry.tipo === 1 && entry.duration > 0) {
          // temporário — persiste para sobreviver a restart
          await PendingTempRoleModel.create({
            guildId,
            userId,
            roleId:   entry.roleId,
            panelId:  panel.panelId,
            ticketId,
            removeAt: Date.now() + entry.duration,
            removed:  false
          });
        }

        if (entry.tipo === 2) {
          // vinculado — rastreia qual ticket está sustentando esse cargo
          await ActiveLinkedRoleModel.create({
            guildId,
            userId,
            roleId:  entry.roleId,
            panelId: panel.panelId,
            ticketId
          });
        }

      } catch (err) {
        console.error(`[AutoRole] Erro ao aplicar cargo ${entry.roleId}:`, err);
      }
    }
  }

  /* ═══════════════════════════════════════════
     REMOVER CARGOS VINCULADOS AO FECHAR TICKET
     ═══════════════════════════════════════════ */

  /**
   * Chamado quando um ticket é fechado.
   * Remove o rastreamento do ticket e, se não restar nenhum ticket ativo
   * mantendo o cargo vinculado para esse usuário, remove o cargo do membro.
   *
   * @param {{ guildId: string, userId: string, ticketId: string }} opts
   */
  async handleTicketClose({ guildId, userId, ticketId }) {
    try {
      // busca todos os registros vinculados a esse ticket
      const records = await ActiveLinkedRoleModel.find({ guildId, userId, ticketId });

      for (const record of records) {
        // remove o rastreamento deste ticket
        await ActiveLinkedRoleModel.deleteOne({ _id: record._id });

        // verifica se ainda existem outros tickets ativos sustentando o mesmo cargo
        const remaining = await ActiveLinkedRoleModel.countDocuments({
          guildId,
          userId,
          roleId: record.roleId
        });

        if (remaining === 0) {
          // nenhum outro ticket ativo — remove o cargo
          await this._removeRoleSafe(guildId, userId, record.roleId);
        }
      }
    } catch (err) {
      console.error('[AutoRole] Erro ao processar fechamento de ticket:', err);
    }
  }

  /* ═══════════════════════════════════════════
     SWEEP DE TEMPORÁRIOS
     ═══════════════════════════════════════════ */

  _startTempRoleSweep() {
    const startInterval = () => {
      setInterval(() => this._sweepTempRoles(), SWEEP_INTERVAL_MS).unref();
      this._sweepTempRoles().catch(console.error);
    };

    // se o MongoDB já está conectado (readyState 1), inicia direto
    if (mongoose.connection.readyState === 1) {
      startInterval();
      return;
    }

    // aguarda o evento 'open' — disparado quando a conexão é estabelecida
    mongoose.connection.once('open', () => {
      console.log('[AutoRole] MongoDB conectado — iniciando sweep de temporários');
      startInterval();
    });
  }

  async _sweepTempRoles() {
    try {
      const now     = Date.now();
      const expired = await PendingTempRoleModel.find({
        removeAt: { $lte: now },
        removed:  false
      });

      for (const record of expired) {
        try {
          await this._removeRoleSafe(record.guildId, record.userId, record.roleId);
          record.removed = true;
          await record.save();
        } catch (err) {
          console.error(`[AutoRole] Sweep — erro ao remover cargo ${record.roleId}:`, err);
        }
      }

      // limpa registros já removidos há mais de 24h (housekeeping)
      await PendingTempRoleModel.deleteMany({
        removed:  true,
        removeAt: { $lte: now - 86_400_000 }
      });

    } catch (err) {
      console.error('[AutoRole] Erro no sweep de temporários:', err);
    }
  }

  /* ═══════════════════════════════════════════
     DISCORD API HELPERS
     ═══════════════════════════════════════════ */

  async _addRole(guildId, userId, roleId) {
    await DiscordRequest(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
      method: 'PUT'
    });
  }

  async _removeRoleSafe(guildId, userId, roleId) {
    try {
      await DiscordRequest(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
        method: 'DELETE'
      });
    } catch (err) {
      // membro pode ter saído do servidor — não é erro crítico
      console.warn(`[AutoRole] Não foi possível remover cargo ${roleId} do usuário ${userId}:`, err?.message);
    }
  }

  /* ═══════════════════════════════════════════
     VALIDAÇÃO DE HIERARQUIA
     ═══════════════════════════════════════════ */

  /**
   * Retorna a posição do cargo mais alto do bot no servidor.
   * Resultado é cacheado por 5 minutos para reduzir API calls.
   */
  async _getBotHighestRolePosition(guildId) {
    const cached = this._botRolePosition.get(guildId);
    if (cached && cached.expires > Date.now()) return cached.position;

    const botUser = await DiscordRequest('/users/@me');
    const member  = await DiscordRequest(`/guilds/${guildId}/members/${botUser.id}`);
    const roles   = await DiscordRequest(`/guilds/${guildId}/roles`);

    let maxPos = 0;
    for (const roleId of member.roles) {
      const role = roles.find(r => r.id === roleId);
      if (role && role.position > maxPos) maxPos = role.position;
    }

    this._botRolePosition.set(guildId, {
      position: maxPos,
      expires:  Date.now() + 300_000 // 5 min cache
    });

    return maxPos;
  }

  /**
   * Verifica se o bot pode atribuir o cargo (posição abaixo do bot).
   */
  async _canAssignRole(guildId, roleId, botMaxPos) {
    try {
      const roles = await DiscordRequest(`/guilds/${guildId}/roles`);
      const role  = roles.find(r => r.id === roleId);
      if (!role) return false;
      return role.position < botMaxPos;
    } catch {
      return false;
    }
  }

  /* ═══════════════════════════════════════════
     UTILITÁRIOS PÚBLICOS
     ═══════════════════════════════════════════ */

  /**
   * Lista cargos vinculados ativos de um usuário em uma guild.
   * Usado para exibição no painel de administração.
   */
  async getActiveLinkedRoles(guildId, userId) {
    return ActiveLinkedRoleModel.find({ guildId, userId });
  }
}

module.exports = AutoRoleManager;
