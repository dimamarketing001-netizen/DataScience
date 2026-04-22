import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const BITRIX_WEBHOOK = process.env.BITRIX_WEBHOOK;

/**
 * Нормализация телефона — убираем всё кроме цифр
 */
function normalizePhone(phone) {
  return phone.replace(/\D/g, '');
}

/**
 * Поиск контакта по телефону
 * Возвращает { contactId, leadId } или null
 */
export async function findByPhone(rawPhone) {
  const phone = normalizePhone(rawPhone);

  // 1. Ищем в контактах
  const contactResult = await searchContact(phone);
  if (contactResult) {
    return contactResult;
  }

  // 2. Если контакт не найден — ищем в лидах
  const leadResult = await searchLead(phone);
  if (leadResult) {
    return leadResult;
  }

  return null;
}

/**
 * Поиск контакта CRM
 */
async function searchContact(phone) {
  try {
    const response = await axios.post(
      `${BITRIX_WEBHOOK}/crm.contact.list`,
      {
        filter: { 'PHONE': phone },
        select: ['ID', 'NAME', 'LAST_NAME', 'PHONE'],
      }
    );

    const contacts = response.data?.result;
    if (!contacts || contacts.length === 0) return null;

    const contact = contacts[0];

    // Ищем лид связанный с контактом
    const leadId = await findLeadByContactId(contact.ID);

    return {
      contactId: parseInt(contact.ID),
      leadId: leadId,
      name: `${contact.NAME || ''} ${contact.LAST_NAME || ''}`.trim(),
      source: 'contact',
    };
  } catch (error) {
    console.error('Ошибка поиска контакта:', error.message);
    return null;
  }
}

/**
 * Поиск лида по телефону
 */
async function searchLead(phone) {
  try {
    const response = await axios.post(
      `${BITRIX_WEBHOOK}/crm.lead.list`,
      {
        filter: { 'PHONE': phone },
        select: ['ID', 'NAME', 'CONTACT_ID', 'PHONE'],
      }
    );

    const leads = response.data?.result;
    if (!leads || leads.length === 0) return null;

    const lead = leads[0];

    return {
      contactId: lead.CONTACT_ID ? parseInt(lead.CONTACT_ID) : null,
      leadId: parseInt(lead.ID),
      name: lead.NAME || '',
      source: 'lead',
    };
  } catch (error) {
    console.error('Ошибка поиска лида:', error.message);
    return null;
  }
}

/**
 * Найти лид связанный с контактом
 */
async function findLeadByContactId(contactId) {
  try {
    const response = await axios.post(
      `${BITRIX_WEBHOOK}/crm.lead.list`,
      {
        filter: { 'CONTACT_ID': contactId },
        select: ['ID'],
        order: { 'DATE_CREATE': 'DESC' },
      }
    );

    const leads = response.data?.result;
    if (!leads || leads.length === 0) return null;

    return parseInt(leads[0].ID);
  } catch (error) {
    console.error('Ошибка поиска лида по контакту:', error.message);
    return null;
  }
}