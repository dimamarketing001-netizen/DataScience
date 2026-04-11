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
    }
};
