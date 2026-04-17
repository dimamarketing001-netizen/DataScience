// Модуль для всех API-запросов, связанных с кассой
App.cashbox.api = {
    getInitialData: function() {
        return App.api.request('cashbox_initial_data');
    },

    getExpenses: function(params) {
        return App.api.request('expenses', params);
    },

    getSingleExpense: function(id) {
        return App.api.request('get_single_expense', { id });
    },

    addExpense: function(data) {
        return App.api.request('add_expense', {}, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    updateExpense: function(data) {
        return App.api.request('update_expense', {}, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    deleteExpense: function(id) {
        return App.api.request('delete_expense', { id }, {
            method: 'DELETE'
        });
    },

    // --- Новые методы для приходов ---

    getIncomes: function(params) {
        return App.api.request('get_incomes', params);
    },

    getSingleIncome: function(id) {
        return App.api.request('get_single_income', { id });
    },

    addIncome: function(data) {
        return App.api.request('add_income', {}, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    updateIncome: function(data) {
        return App.api.request('update_income', {}, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    deleteIncome: function(id) {
        return App.api.request('delete_income', { id }, {
            method: 'DELETE'
        });
    },

    getClientDeals: function(contactId) {
        return App.api.request('get_client_deals', { contact_id: contactId });
    },

    toggleIncomeConfirmation: function(id, confirm) {
        return App.api.request('toggle_income_confirmation', {}, {
            method: 'POST',
            body: JSON.stringify({ id, confirm, confirmed_by_user_id: App.currentUser.ID })
        });
    },
};
